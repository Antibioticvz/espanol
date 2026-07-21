import { ParserService, computeStats } from '../core/parser/parser.service'
import { MockSayService } from '../core/tts/mock-say.service'
import { ElevenLabsService } from '../core/tts/eleven-labs.service'
import type { TTSProvider } from '../core/tts/tts-provider'
import {
  applyTaskResult,
  buildLessonSkeleton,
  flattenToTasks,
  markId3Written,
  sumCharactersForDoneItems
} from '../core/queue/build-items'
import { GenerationQueue } from '../core/queue/generation-queue'
import type { GenerationProgressEvent, GenerationTask, QueueConfig } from '../core/types/generation'
import { isGroupsBlockJson, type ItemStatus, type LessonJson, type VoiceRef } from '../core/types/lesson-json'
import type { ParsedLesson } from '../core/types/parsed-lesson'
import type { AppSettings } from '../core/types/settings'
import { CostCalculator } from '../core/cost/cost-calculator'
import { isFfmpegAvailable } from '../core/util/ffmpeg'
import { getAppContext } from './services-bootstrap'

export interface StartGenerationParams {
  inputText: string
  settings: AppSettings
  /**
   * Явный (возможно ещё НЕ сохранённый через settings.setApiKey) ключ ElevenLabs — см.
   * src/shared/ipc.ts#StartGenerationInput. Необязателен и не используется существующим
   * вложенным `window.combine.generation.start` (там ключ всегда берётся из secure storage);
   * плоский `window.combineApi.startGeneration` (см. ipc-handlers.ts, D-22 в docs/DECISIONS.md
   * — координация моста) передаёт его явно, потому что renderer хранит ключ только в состоянии
   * формы до нажатия «Сохранить».
   */
  apiKey?: string | null
}

/** Вариант start() для уже разобранного текста (плоский контракт shared/ipc.ts#startGeneration
 * получает готовый ParsedLesson, а не сырой текст — renderer уже прогнал parseText() и показал
 * дерево разбора пользователю до нажатия «Сгенерировать»). */
export interface StartParsedGenerationParams {
  lesson: ParsedLesson
  settings: AppSettings
  apiKey?: string | null
}

export interface StartGenerationOutcome {
  topicId: string
  lesson: LessonJson
}

export interface RegenerateParams {
  topicId: string
  outputRoot: string
  /** 'all' — переделать всё; 'failed' — только элементы со статусом failed (см. §4.4 спеки). */
  mode: 'all' | 'failed'
  queueConfig: QueueConfig
  pricePerThousandChars: Record<string, number>
  /**
   * v1.2 (D-23): в отличие от provider/model/voices/stability (см. D-20 — те переиспользуют config
   * УЖЕ СОХРАНЁННЫЙ в lesson.json, не текущие настройки, чтобы не намешать голоса/модели в одном
   * уроке), normalizeAudio не влияет на СОДЕРЖИМОЕ аудио одной и той же фразы одинаково при любом
   * значении переключателя (нормализованный/нет уровень громкости — не другой голос/текст), поэтому
   * трактуется как параметр очереди (см. docstring у queueConfig/pricePerThousandChars выше) —
   * берётся из ТЕКУЩИХ настроек, не хранится в схеме lesson.json. По умолчанию true, если не передан
   * (обратная совместимость вызовов, которые ещё не знают об этом поле).
   */
  normalizeAudio?: boolean
}

function resetItemStatus(item: { status: ItemStatus; error?: string | null }, mode: 'all' | 'failed'): void {
  if (mode === 'all' || item.status === 'failed') {
    item.status = 'pending'
    item.error = null
  }
}

/**
 * Держит ОДИН активный сеанс генерации в main-процессе (одновременно генерируется один урок,
 * см. §4.3 спеки). IPC-хендлеры (ipc-handlers.ts) дергают start/startRegenerate/pause/resume/
 * cancel; прогресс идёт через onProgress-колбэк, который хендлер форвардит в renderer
 * (имя канала/событие — на усмотрение UI-агента при стыковке, см. коммент координатора).
 *
 * Второй раунд ревью (Opus) нашёл три взаимосвязанных бага здесь, все исправлены:
 *  - finalize() был навешан на .then() ПЕРВОГО queue.start() — срабатывал преждевременно при
 *    pause (queue.start() резолвится, когда p-queue становится idle, что происходит и при паузе,
 *    не только при истинном завершении) и НЕ срабатывал вовсе после resume() (новый queue.start()
 *    внутри resume() — отдельный промис, не связанный с тем .then()). Теперь finalize() триггерится
 *    строго по фактическому событию `runState === 'done'` из очереди — оно эмитится ровно один раз,
 *    какими бы ни были промежуточные pause/resume.
 *  - start()/startRegenerate() не проверяли isActive(): второй вызов подряд молча перезаписывал
 *    queue/lessonJson/tasks этого объекта, а СТАРАЯ очередь при этом продолжала крутиться в фоне
 *    и постоянно персистить уже подменённые (новые) this.tasks поверх lesson.json СТАРОГО урока —
 *    перекрёстная порча. Теперь оба метода бросают, если isActive().
 *  - isActive() никогда не возвращала false обратно (queue не обнулялся) — теперь finalize()
 *    (в finally, чтобы отработало и при ошибке записи) обнуляет this.queue.
 *
 * Класс экспортирован (не только синглтон-инстанс ниже) специально для тестов — позволяет
 * создавать изолированные инстансы с замоканным services-bootstrap#getAppContext() вместо
 * общего состояния синглтона.
 */
export class GenerationSession {
  private queue: GenerationQueue | null = null
  private lessonJson: LessonJson | null = null
  private tasks: GenerationTask[] = []
  private topicId: string | null = null
  private outputRoot: string | null = null
  private addId3 = true
  /** Сериализует все writeLessonJson() этого сеанса — см. класс-докстринг и docstring persist(). */
  private persistChain: Promise<void> = Promise.resolve()

  isActive(): boolean {
    return this.queue !== null
  }

  getTopicId(): string | null {
    return this.topicId
  }

  /** Новая генерация из сырого текста (импорт) — резюмирует, если lesson.json для topic_id уже есть. */
  async start(params: StartGenerationParams, onProgress: (event: GenerationProgressEvent) => void): Promise<StartGenerationOutcome> {
    if (this.isActive()) {
      throw new Error('Генерация уже выполняется — дождитесь завершения, поставьте на паузу или отмените текущую.')
    }
    const parseResult = new ParserService().parse(params.inputText)
    if (!parseResult.lesson || parseResult.errors.length > 0) {
      const details = parseResult.errors.map((e) => (e.line !== null ? `строка ${e.line}: ${e.message}` : e.message)).join('; ')
      throw new Error(`Ошибки парсера (${parseResult.errors.length}): ${details}`)
    }
    return this.startCommon(parseResult.lesson, params.settings, params.apiKey ?? null, onProgress)
  }

  /** Вариант start() для уже разобранного (renderer уже вызвал parseText()) урока — см. StartParsedGenerationParams. */
  async startParsed(
    params: StartParsedGenerationParams,
    onProgress: (event: GenerationProgressEvent) => void
  ): Promise<StartGenerationOutcome> {
    if (this.isActive()) {
      throw new Error('Генерация уже выполняется — дождитесь завершения, поставьте на паузу или отмените текущую.')
    }
    return this.startCommon(params.lesson, params.settings, params.apiKey ?? null, onProgress)
  }

  private async startCommon(
    lesson: ParsedLesson,
    settings: AppSettings,
    apiKey: string | null,
    onProgress: (event: GenerationProgressEvent) => void
  ): Promise<StartGenerationOutcome> {
    const { fileService } = getAppContext()

    const provider = await this.createProvider(settings.provider, settings.queue.maxRetries, apiKey, settings.normalizeAudio)
    const { voiceEs, voiceRu } = await this.resolveVoices(provider, settings.voiceEs?.id, settings.voiceRu?.id)

    const topicId = lesson.topicId
    const outputRoot = settings.outputDir
    const resuming = await fileService.lessonExists(outputRoot, topicId)

    let lessonJson: LessonJson
    if (resuming) {
      lessonJson = await fileService.readLessonJson(outputRoot, topicId)
    } else {
      const stats = computeStats(lesson)
      lessonJson = buildLessonSkeleton(
        lesson,
        {
          provider: provider.id,
          model: settings.model,
          voices: { es: voiceEs, ru: voiceRu },
          stability: settings.stability,
          similarityBoost: settings.similarityBoost,
          seed: settings.seed
        },
        stats
      )
      await fileService.writeLessonJson(outputRoot, topicId, lessonJson)
    }

    // v1.2 (D-23): один раз на весь прогон — не по фразе (см. GenerationQueue#synthesizeLang).
    // ПОСЛЕ writeLessonJson()/readLessonJson() выше — только тогда гарантирован каталог урока
    // (appendGenerationLog не создаёт родительские папки сам, см. FileService).
    await this.logNormalizationStatus(fileService, outputRoot, topicId, provider.id, settings.normalizeAudio)

    const pricing = new CostCalculator(settings.pricePerThousandChars)
    this.runQueue({
      topicId,
      outputRoot,
      lessonJson,
      provider,
      voices: { es: voiceEs, ru: voiceRu },
      queueConfig: settings.queue,
      addId3: settings.addId3Tags,
      pricing,
      onProgress
    })

    return { topicId, lesson: lessonJson }
  }

  /** «Переделать всё» / «Переделать only failed» из библиотеки — использует config уже сохранённый в lesson.json. */
  async startRegenerate(
    params: RegenerateParams,
    onProgress: (event: GenerationProgressEvent) => void
  ): Promise<StartGenerationOutcome> {
    if (this.isActive()) {
      throw new Error('Генерация уже выполняется — дождитесь завершения, поставьте на паузу или отмените текущую.')
    }
    const { fileService } = getAppContext()
    const lessonJson = await fileService.readLessonJson(params.outputRoot, params.topicId)

    for (const block of lessonJson.blocks) {
      if (isGroupsBlockJson(block)) {
        for (const group of block.groups) for (const phrase of group.phrases) resetItemStatus(phrase, params.mode)
      } else if (block.type === 'vocabulary') {
        for (const word of block.words) resetItemStatus(word, params.mode)
      } else {
        resetItemStatus(block, params.mode)
      }
    }
    await fileService.writeLessonJson(params.outputRoot, params.topicId, lessonJson)

    const normalizeAudio = params.normalizeAudio ?? true
    const provider = await this.createProvider(lessonJson.config.provider, params.queueConfig.maxRetries, null, normalizeAudio)
    await this.logNormalizationStatus(fileService, params.outputRoot, params.topicId, provider.id, normalizeAudio)
    const pricing = new CostCalculator(params.pricePerThousandChars)

    this.runQueue({
      topicId: params.topicId,
      outputRoot: params.outputRoot,
      lessonJson,
      provider,
      voices: { es: lessonJson.config.voice_es, ru: lessonJson.config.voice_ru },
      queueConfig: params.queueConfig,
      addId3: true,
      pricing,
      onProgress
    })

    return { topicId: params.topicId, lesson: lessonJson }
  }

  pause(): void {
    this.queue?.pause()
  }

  /**
   * НЕ ждём завершения всей (оставшейся) генерации — раньше resume() был `await this.queue.resume()`,
   * а GenerationQueue.resume() сам делает `await this.start()`, который резолвится только когда
   * очередь ЦЕЛИКОМ опустеет (queue.onIdle()). Поскольку IPC-хендлер, в свою очередь, await'ит
   * generationSession.resume(), весь вызов `ipcRenderer.invoke('combine:generation:resume')`
   * зависал в renderer на всё оставшееся время генерации (реально — минуты). Возобновление должно
   * лишь ЗАПУСТИТЬ работу в фоне и сразу же вернуть управление — как и start()/startRegenerate().
   */
  resume(): void {
    this.queue?.resume().catch((e: unknown) => {
      console.warn(`[GenerationSession] Ошибка при возобновлении: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  cancel(): void {
    this.queue?.cancel()
  }

  /**
   * explicitApiKey (не пустая строка) побеждает — так работает StartParsedGenerationParams.apiKey
   * (ключ ещё не сохранён, но введён в форме настроек). Иначе — обычный путь: ключ из secure storage.
   * normalizeAudio по умолчанию true (см. AppSettings.normalizeAudio, D-23).
   */
  private async createProvider(
    providerName: 'mock_say' | 'elevenlabs',
    maxRetries: number,
    explicitApiKey?: string | null,
    normalizeAudio = true
  ): Promise<TTSProvider> {
    if (providerName === 'mock_say') return new MockSayService({ normalize: normalizeAudio })
    const apiKey = explicitApiKey && explicitApiKey.trim().length > 0 ? explicitApiKey : await getAppContext().settingsService.getApiKey()
    if (!apiKey) throw new Error('API-ключ ElevenLabs не задан — откройте настройки и введите ключ.')
    return new ElevenLabsService({ apiKey, maxRetries, normalize: normalizeAudio })
  }

  /**
   * v1.2 (D-23): один раз за прогон (не по фразе) — фиксирует в generation.log, будет ли реально
   * применяться нормализация громкости для этого урока. mock_say с включённой настройкой всегда
   * успешен (чистый JS) — писать об этом нечего. ElevenLabs зависит от наличия ffmpeg в PATH —
   * пользователю полезно знать ДО того, как урок сгенерируется, почему фразы вышли (не)нормализованными.
   */
  private async logNormalizationStatus(
    fileService: ReturnType<typeof getAppContext>['fileService'],
    outputRoot: string,
    topicId: string,
    providerId: 'mock_say' | 'elevenlabs',
    normalizeAudio: boolean
  ): Promise<void> {
    if (providerId !== 'elevenlabs') return
    if (!normalizeAudio) {
      await fileService.appendGenerationLog(outputRoot, topicId, 'Нормализация громкости выключена в настройках — фразы сохранены как есть.')
      return
    }
    const available = await isFfmpegAvailable()
    await fileService.appendGenerationLog(
      outputRoot,
      topicId,
      available
        ? 'Нормализация громкости: ffmpeg найден — применяется loudnorm (EBU R128, I=-18 LUFS) к каждой фразе ElevenLabs.'
        : 'Нормализация громкости недоступна: ffmpeg не найден в PATH — фразы сохранены без нормализации (установите ffmpeg, напр. `brew install ffmpeg`).'
    )
  }

  private async resolveVoices(
    provider: TTSProvider,
    preferredEsId: string | undefined,
    preferredRuId: string | undefined
  ): Promise<{ voiceEs: VoiceRef; voiceRu: VoiceRef }> {
    if (provider.resolveVoice) {
      const es = await provider.resolveVoice('es', preferredEsId)
      const ru = await provider.resolveVoice('ru', preferredRuId)
      return { voiceEs: { id: es.id, name: es.name }, voiceRu: { id: ru.id, name: ru.name } }
    }
    if (!preferredEsId || !preferredRuId) {
      throw new Error('Выберите голоса ES и RU в настройках (ElevenLabs требует явный voice_id).')
    }
    return { voiceEs: { id: preferredEsId, name: preferredEsId }, voiceRu: { id: preferredRuId, name: preferredRuId } }
  }

  private runQueue(args: {
    topicId: string
    outputRoot: string
    lessonJson: LessonJson
    provider: TTSProvider
    voices: { es: VoiceRef; ru: VoiceRef }
    queueConfig: QueueConfig
    addId3: boolean
    pricing: CostCalculator
    onProgress: (event: GenerationProgressEvent) => void
  }): void {
    const { fileService } = getAppContext()
    this.topicId = args.topicId
    this.outputRoot = args.outputRoot
    this.lessonJson = args.lessonJson
    this.addId3 = args.addId3

    const audioRoot = fileService.lessonDir(args.outputRoot, args.topicId)
    this.tasks = flattenToTasks(args.lessonJson, audioRoot, args.voices)

    const pricePerThousand = args.pricing.priceForModel(args.lessonJson.config.model)
    const startedAt = Date.now()

    this.queue = new GenerationQueue(
      this.tasks,
      args.queueConfig,
      args.provider,
      {
        modelId: args.lessonJson.config.model,
        stability: args.lessonJson.config.stability ?? null,
        similarityBoost: args.lessonJson.config.similarity_boost ?? null,
        seed: args.lessonJson.config.seed ?? null
      },
      {
        pricePerThousandChars: pricePerThousand,
        onAudioSaved: async (task, lang, filePath) => {
          if (!this.addId3 || !this.lessonJson) return
          try {
            await fileService.writeId3Tags(filePath, {
              title: task.esText,
              artist: lang === 'es' ? task.esVoiceName : task.ruVoiceName,
              album: this.lessonJson.title_ru,
              comment: task.ruText,
              track: task.phraseId
            })
          } catch {
            // Не фатально для генерации — фраза уже озвучена, просто без тегов.
          }
        }
      }
    )

    this.queue.on('progress', (event: GenerationProgressEvent) => {
      args.onProgress(event)
      if (event.item && !event.item.lang && (event.item.status === 'done' || event.item.status === 'failed')) {
        void this.persist()
      }
      // Именно ЭТО, а не .then() исходного queue.start() — единственный надёжный триггер финализации:
      // эмитится ровно один раз при истинном завершении, переживает любое число pause()/resume().
      if (event.runState === 'done') {
        void this.finalize(args.pricing, startedAt)
      }
    })

    // Не await — управление возвращается сразу, генерация продолжается в фоне; на непредвиденный
    // reject (сам GenerationQueue такого не бросает, но защищаемся от регрессий) — просто логируем.
    this.queue.start().catch((e: unknown) => {
      console.warn(`[GenerationSession] queue.start() завершился с ошибкой: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  /**
   * Персист текущего состояния lesson.json. Вызовы СЕРИАЛИЗОВАНЫ через persistChain — GenerationQueue
   * эмитит progress-события по мере завершения КАЖДОЙ задачи, и без сериализации несколько
   * fire-and-forget persist() могли бы одновременно читать/писать один this.lessonJson и гонять
   * конкурентные writeLessonJson() (которая сама по себе атомарна — temp+rename, см. FileService,
   * но порядок применения "какая версия легла последней" всё равно нуждается в дисциплине вызова).
   */
  private persist(): Promise<void> {
    this.persistChain = this.persistChain.then(() => this.doPersist())
    return this.persistChain
  }

  private async doPersist(): Promise<void> {
    if (!this.lessonJson || !this.outputRoot || !this.topicId) return
    for (const t of this.tasks) {
      applyTaskResult(this.lessonJson, t)
      if (this.addId3 && t.status === 'done') markId3Written(this.lessonJson, t)
    }
    try {
      await getAppContext().fileService.writeLessonJson(this.outputRoot, this.topicId, this.lessonJson)
    } catch (e) {
      console.warn(`[GenerationSession] Не удалось сохранить lesson.json: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async finalize(pricing: CostCalculator, startedAt: number): Promise<void> {
    if (!this.queue) return // уже финализировано (защита от повторного вызова)
    try {
      // Дожидаемся ВСЕХ уже поставленных в очередь persist(), затем пишем финальную версию —
      // тем же persistChain, чтобы не гнаться с ещё не отработавшим promise-то из doPersist().
      await this.persist()
      if (!this.lessonJson || !this.outputRoot || !this.topicId) return
      const { fileService } = getAppContext()
      // issue #8: считаем ПО ВСЕМ done-элементам lesson.json, а не только по this.tasks текущей
      // сессии — при резюме частично готового урока flattenToTasks() намеренно не включает уже
      // done элементы (идемпотентность), и сумма только по "новым" tasks занижала бы итоговую
      // стоимость всего урока.
      const totalCharacters = sumCharactersForDoneItems(this.lessonJson)
      this.lessonJson.stats.actual_cost_usd = pricing.actualFromCharacters(totalCharacters, this.lessonJson.config.model)
      this.lessonJson.stats.generation_duration_seconds = Math.round((Date.now() - startedAt) / 1000)
      this.lessonJson.stats.file_size_mb = Math.round((await fileService.lessonSizeMb(this.outputRoot, this.topicId)) * 100) / 100
      await fileService.writeLessonJson(this.outputRoot, this.topicId, this.lessonJson)
      await fileService.appendGenerationLog(this.outputRoot, this.topicId, 'Генерация завершена (см. lesson.json для деталей).')
    } finally {
      // ВСЕГДА обнуляем, даже если запись выше упала — иначе isActive() навсегда останется true
      // и приложение больше никогда не даст запустить новую генерацию (issue #6).
      this.queue = null
    }
  }
}

export const generationSession = new GenerationSession()
