import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ParserService, computeStats } from '../../core/parser/parser.service'
import { MockSayService } from '../../core/tts/mock-say.service'
import { ElevenLabsService } from '../../core/tts/eleven-labs.service'
import type { TTSProvider } from '../../core/tts/tts-provider'
import {
  applyTaskResult,
  buildLessonSkeleton,
  flattenToTasks,
  markId3Written,
  sumCharactersForDoneItems
} from '../../core/queue/build-items'
import { GenerationQueue } from '../../core/queue/generation-queue'
import { FileService } from '../../core/file/file.service'
import { CostCalculator } from '../../core/cost/cost-calculator'
import { DEFAULT_PRICING } from '../../core/types/settings'
import type { LessonJson, VoiceRef } from '../../core/types/lesson-json'
import type { GenerationTask, QueueConfig } from '../../core/types/generation'
import { getSharedSchemaPath } from '../../core/util/paths'
import { isFfmpegAvailable } from '../../core/util/ffmpeg'
import { boolFlag, numFlag, strFlag, type CliFlags } from '../args'

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Результат генерации ОДНОЙ темы — используется и для одиночного файла, и как элемент пакетной сводки. */
interface TopicResult {
  code: number
  topicId: string | null
  error: string | null
}

/**
 * `cli generate --input <файл-или-папка> --provider mock_say|elevenlabs --out <папка> [--export-zip] [опции]`
 * (D-10) — headless-генерация без Electron. Это ЕДИНСТВЕННЫЙ путь, который реально тратит деньги
 * при provider=elevenlabs — но НИКОГДА не вызывается тестами (см. правило №1 CLAUDE.md); для
 * тестов/CI используется provider=mock_say (см. scripts/integration-test.mjs в корне монорепо).
 *
 * Пакетный режим (v1.1, docs/DECISIONS.md D-22): если --input указывает на ПАПКУ, обрабатываются
 * все файлы `*.txt` внутри неё по алфавиту, СТРОГО ПОСЛЕДОВАТЕЛЬНО (одна generateOneTopic() за
 * раз — соответствует однопоточной GenerationSession-логике реального приложения, где одновременно
 * может идти только один урок). Ошибка одной темы (битый файл, ошибка парсера, сбой генерации) НЕ
 * прерывает обработку остальных — она просто попадает в тему как "с ошибкой", и цикл идёт дальше.
 * В конце печатается сводка (сколько ок / сколько с ошибками / код на каждую тему), а код возврата
 * всего процесса ненулевой, если хотя бы одна тема провалилась (даже если остальные готовы) —
 * так CI/скрипты видят частичный провал, не читая сводку построчно.
 */
export async function runGenerate(flags: CliFlags): Promise<number> {
  const input = strFlag(flags, 'input')
  const outRoot = strFlag(flags, 'out')
  const providerName = strFlag(flags, 'provider') ?? 'mock_say'

  if (!input || !outRoot) {
    console.error('Использование: generate --input <файл-или-папка> --provider mock_say|elevenlabs --out <папка> [--export-zip]')
    return 1
  }
  if (providerName !== 'mock_say' && providerName !== 'elevenlabs') {
    console.error(`Неизвестный provider "${providerName}". Допустимо: mock_say, elevenlabs.`)
    return 1
  }

  let inputIsDirectory: boolean
  try {
    inputIsDirectory = statSync(input).isDirectory()
  } catch (e) {
    console.error(`Не удалось прочитать входной путь ${input}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  if (!inputIsDirectory) {
    const result = await generateOneTopic(input, outRoot, providerName, flags)
    return result.code
  }

  const files = readdirSync(input)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))

  if (files.length === 0) {
    console.error(`В папке «${input}» не найдено файлов .txt.`)
    return 1
  }

  console.log(`Пакетная генерация: ${files.length} файл(ов) в «${input}» (по алфавиту, последовательно).`)

  const results: Array<TopicResult & { file: string }> = []
  for (const file of files) {
    const filePath = join(input, file)
    console.log(`\n─── ${file} ───`)
    const result = await generateOneTopic(filePath, outRoot, providerName, flags)
    if (result.error) console.error(`✗ Ошибка генерации «${file}»: ${result.error}`)
    results.push({ file, ...result })
  }

  const ok = results.filter((r) => r.code === 0)
  const failed = results.filter((r) => r.code !== 0)

  console.log('\n=== Итоги пакетной генерации ===')
  console.log(`Успешно: ${ok.length}/${results.length}, с ошибками: ${failed.length}/${results.length}`)
  for (const r of results) {
    const mark = r.code === 0 ? '✓' : '✗'
    const label = r.topicId ? `${r.file} (${r.topicId})` : r.file
    console.log(`  ${mark} ${label} — код ${r.code}${r.error ? `: ${r.error}` : ''}`)
  }

  return failed.length > 0 ? 1 : 0
}

/**
 * Генерирует ОДНУ тему целиком (в точности та же логика, что раньше была телом runGenerate() для
 * одиночного файла) — обёрнута в try/catch, чтобы неожиданное исключение (не только "мягкие"
 * возвраты кода 1 из парсера/валидации ниже) не прерывало пакетный цикл в runGenerate().
 */
async function generateOneTopic(inputPath: string, outRoot: string, providerName: string, flags: CliFlags): Promise<TopicResult> {
  try {
    let raw: string
    try {
      raw = readFileSync(inputPath, 'utf8')
    } catch (e) {
      console.error(`Не удалось прочитать входной файл ${inputPath}: ${e instanceof Error ? e.message : String(e)}`)
      return { code: 1, topicId: null, error: `не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}` }
    }

    const parseResult = new ParserService().parse(raw)
    if (parseResult.warnings.length > 0) {
      console.warn(`Предупреждения парсера (${parseResult.warnings.length}):`)
      for (const w of parseResult.warnings) console.warn(`  ⚠ ${w.line !== null ? `строка ${w.line}: ` : ''}${w.message}`)
    }
    if (parseResult.errors.length > 0 || !parseResult.lesson) {
      console.error(`Ошибки парсера (${parseResult.errors.length}) — генерация отменена:`)
      for (const e of parseResult.errors) console.error(`  ✗ ${e.line !== null ? `строка ${e.line}: ` : ''}${e.message}`)
      const details = parseResult.errors.map((e) => (e.line !== null ? `строка ${e.line}: ${e.message}` : e.message)).join('; ')
      return { code: 1, topicId: null, error: `ошибки парсера: ${details}` }
    }
    const lesson = parseResult.lesson

    const model = strFlag(flags, 'model') ?? (providerName === 'mock_say' ? 'macos_say' : 'eleven_multilingual_v2')
    // Клампим на всякий случай (issue #11 второго ревью): отрицательный/мусорный --max-retries
    // (напр. -1) заставлял ElevenLabsService.withRetry() ни разу не войти в цикл `for (attempt=0;
    // attempt<=maxRetries; ...)` и в итоге `throw lastError`, который так и остался `undefined` —
    // непонятный "throw undefined" вместо внятной ошибки. delay-ms/timeout-ms клампим аналогично.
    const queueConfig: QueueConfig = {
      concurrency: clamp(numFlag(flags, 'concurrency', 3), 1, 5),
      maxRetries: clamp(numFlag(flags, 'max-retries', 3), 0, 10),
      delayMs: clamp(numFlag(flags, 'delay-ms', 100), 0, 60_000),
      timeoutMs: clamp(numFlag(flags, 'timeout-ms', 30_000), 1_000, 300_000)
    }
    const stability = flags.stability !== undefined ? clamp(numFlag(flags, 'stability', 0.5), 0, 1) : null
    const similarityBoost = flags['similarity-boost'] !== undefined ? clamp(numFlag(flags, 'similarity-boost', 0.75), 0, 1) : null
    const seed = flags.seed !== undefined ? Math.max(0, Math.trunc(numFlag(flags, 'seed', 0))) : null
    // v1.2 (D-23): нормализация громкости включена по умолчанию — см. --no-normalize в usage.
    const normalizeAudio = !boolFlag(flags, 'no-normalize')

    let provider: TTSProvider
    if (providerName === 'mock_say') {
      provider = new MockSayService({ normalize: normalizeAudio })
    } else {
      const apiKey = strFlag(flags, 'api-key') ?? process.env.ELEVENLABS_API_KEY
      if (!apiKey) {
        console.error('Для provider=elevenlabs укажите ключ: --api-key <ключ> или переменная окружения ELEVENLABS_API_KEY.')
        return { code: 1, topicId: null, error: 'не задан API-ключ ElevenLabs' }
      }
      provider = new ElevenLabsService({ apiKey, maxRetries: queueConfig.maxRetries, normalize: normalizeAudio })
    }

    const preferredEs = strFlag(flags, 'voice-es') ?? null
    const preferredRu = strFlag(flags, 'voice-ru') ?? null
    let voiceEs: VoiceRef
    let voiceRu: VoiceRef
    if (provider.resolveVoice) {
      const es = await provider.resolveVoice('es', preferredEs)
      const ru = await provider.resolveVoice('ru', preferredRu)
      if (es.warning) console.warn(`⚠ ${es.warning}`)
      if (ru.warning) console.warn(`⚠ ${ru.warning}`)
      voiceEs = { id: es.id, name: es.name }
      voiceRu = { id: ru.id, name: ru.name }
    } else {
      if (!preferredEs || !preferredRu) {
        console.error('Для provider=elevenlabs укажите --voice-es <voice_id> и --voice-ru <voice_id> (см. GET /v1/voices).')
        return { code: 1, topicId: null, error: 'не заданы --voice-es/--voice-ru для elevenlabs' }
      }
      let nameEs = preferredEs
      let nameRu = preferredRu
      try {
        const voices = await provider.listVoices()
        nameEs = voices.find((v) => v.id === preferredEs)?.name ?? preferredEs
        nameRu = voices.find((v) => v.id === preferredRu)?.name ?? preferredRu
      } catch {
        // Не критично для генерации — используем сам id как имя, если список голосов недоступен.
      }
      voiceEs = { id: preferredEs, name: nameEs }
      voiceRu = { id: preferredRu, name: nameRu }
    }

    const fileService = new FileService(getSharedSchemaPath())
    const topicId = lesson.topicId

    let lessonJson: LessonJson
    const resuming = await fileService.lessonExists(outRoot, topicId)
    if (resuming) {
      console.log(`Найден существующий lesson.json для «${topicId}» — резюмируем (только pending/failed).`)
      lessonJson = await fileService.readLessonJson(outRoot, topicId)
    } else {
      const stats = computeStats(lesson)
      lessonJson = buildLessonSkeleton(
        lesson,
        { provider: provider.id, model, voices: { es: voiceEs, ru: voiceRu }, stability, similarityBoost, seed },
        stats
      )
      await fileService.writeLessonJson(outRoot, topicId, lessonJson)
    }

    // v1.2 (D-23): один раз на весь прогон (не по фразе) — см. тот же приём в GenerationSession.
    if (provider.id === 'elevenlabs') {
      if (!normalizeAudio) {
        console.log('Нормализация громкости выключена (--no-normalize) — фразы сохранены как есть.')
        await fileService.appendGenerationLog(outRoot, topicId, 'Нормализация громкости выключена (--no-normalize) — фразы сохранены как есть.')
      } else {
        const ffmpegOk = await isFfmpegAvailable()
        const line = ffmpegOk
          ? 'Нормализация громкости: ffmpeg найден — применяется loudnorm (EBU R128, I=-18 LUFS) к каждой фразе.'
          : 'Нормализация громкости недоступна: ffmpeg не найден в PATH — фразы сохранены без нормализации (установите ffmpeg, напр. `brew install ffmpeg`).'
        console.log(line)
        await fileService.appendGenerationLog(outRoot, topicId, line)
      }
    }

    const audioRoot = fileService.lessonDir(outRoot, topicId)
    const tasks: GenerationTask[] = flattenToTasks(lessonJson, audioRoot, { es: voiceEs, ru: voiceRu })
    console.log(`К озвучке: ${tasks.length} элемент(ов) (провайдер=${providerName}, модель=${model}).`)

    const pricing = new CostCalculator(DEFAULT_PRICING)
    const pricePerThousand = pricing.priceForModel(model)
    const addId3 = !boolFlag(flags, 'no-id3')
    const startedAt = Date.now()

    // Сериализуем ВСЕ записи lesson.json через цепочку промисов (issue #4 второго ревью): при
    // concurrency > 1 несколько задач могут завершиться почти одновременно, и без сериализации
    // несколько fire-and-forget applyAndPersist() гоняли бы конкурентные writeLessonJson() —
    // сама запись атомарна (temp+rename, см. FileService), но порядок применения состояния
    // нуждается в дисциплине вызова, иначе поздняя запись может проиграть более ранней.
    let persistChain: Promise<void> = Promise.resolve()
    const applyAndPersist = (): Promise<void> => {
      persistChain = persistChain.then(async () => {
        for (const t of tasks) {
          applyTaskResult(lessonJson, t)
          if (addId3 && t.status === 'done') markId3Written(lessonJson, t)
        }
        try {
          await fileService.writeLessonJson(outRoot, topicId, lessonJson)
        } catch (e) {
          console.warn(`⚠ Не удалось сохранить промежуточный lesson.json: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
      return persistChain
    }

    const queue = new GenerationQueue(
      tasks,
      queueConfig,
      provider,
      { modelId: model, stability, similarityBoost, seed },
      {
        pricePerThousandChars: pricePerThousand,
        onAudioSaved: async (task, lang, filePath) => {
          if (!addId3) return
          try {
            await fileService.writeId3Tags(filePath, {
              title: task.esText,
              artist: lang === 'es' ? task.esVoiceName : task.ruVoiceName,
              album: lessonJson.title_ru,
              comment: task.ruText,
              track: task.phraseId
            })
          } catch (e) {
            console.warn(`⚠ Не удалось записать ID3 для ${filePath}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }
    )

    queue.on('progress', (event) => {
      if (event.logLine) console.log(event.logLine)
      // Персистим lesson.json на КАЖДОЕ завершение задачи целиком (done/failed без lang — см.
      // класс-докстринг GenerationQueue), а не на каждый под-шаг ES/RU — идемпотентность и
      // устойчивость к падению процесса посреди долгой генерации (docs/SPEC_COMBINE.md §9).
      if (event.item && !event.item.lang && (event.item.status === 'done' || event.item.status === 'failed')) {
        void applyAndPersist()
      }
    })

    let interrupted = false
    const onSigint = (): void => {
      interrupted = true
      console.log('\n⏸ Получен Ctrl+C — приостанавливаем и сохраняем прогресс...')
      queue.pause()
    }
    process.on('SIGINT', onSigint)

    await queue.start()
    await persistChain // дожидаемся ВСЕХ уже поставленных в очередь persist-записей по порядку
    process.off('SIGINT', onSigint)

    await applyAndPersist()

    // issue #8 второго ревью: считаем ПО ВСЕМ done-элементам lesson.json (включая завершённые в
    // ПРЕДЫДУЩИХ запусках при резюме), а не только по tasks текущей сессии — flattenToTasks()
    // намеренно не включает уже done элементы (идемпотентность), и сумма только по "новым" tasks
    // занижала бы итоговую стоимость всего урока.
    const totalCharacters = sumCharactersForDoneItems(lessonJson)
    lessonJson.stats.actual_cost_usd = pricing.actualFromCharacters(totalCharacters, model)
    lessonJson.stats.generation_duration_seconds = Math.round((Date.now() - startedAt) / 1000)
    lessonJson.stats.file_size_mb = Math.round((await fileService.lessonSizeMb(outRoot, topicId)) * 100) / 100
    await fileService.writeLessonJson(outRoot, topicId, lessonJson)

    const summary = fileService.summarize(lessonJson, lessonJson.stats.file_size_mb)
    await fileService.appendGenerationLog(
      outRoot,
      topicId,
      `Генерация завершена: ${summary.doneItems}/${summary.totalItems} done, ${summary.failedItems} failed, ` +
        `$${(lessonJson.stats.actual_cost_usd ?? 0).toFixed(4)}, ${lessonJson.stats.generation_duration_seconds}с`
    )

    console.log(`\nИтого: ${summary.doneItems}/${summary.totalItems} готово, ${summary.failedItems} с ошибками.`)
    console.log(`Стоимость (факт): $${(lessonJson.stats.actual_cost_usd ?? 0).toFixed(4)}`)
    console.log(`Папка: ${audioRoot}`)

    if (boolFlag(flags, 'export-zip')) {
      const zipPath = fileService.defaultZipPath(outRoot, topicId)
      await fileService.exportZip(outRoot, topicId, zipPath)
      console.log(`ZIP: ${zipPath}`)
    }

    if (interrupted) {
      console.log('Генерация прервана пользователем (Ctrl+C) — прогресс сохранён, перезапустите ту же команду для резюме.')
      return { code: 1, topicId, error: 'прервано пользователем (Ctrl+C)' }
    }
    return {
      code: summary.failedItems > 0 ? 1 : 0,
      topicId,
      error: summary.failedItems > 0 ? `${summary.failedItems} элемент(ов) с ошибками` : null
    }
  } catch (e) {
    const message = e instanceof Error ? (e.stack ?? e.message) : String(e)
    console.error(`✗ Непредвиденная ошибка генерации ${inputPath}: ${message}`)
    return { code: 1, topicId: null, error: e instanceof Error ? e.message : String(e) }
  }
}
