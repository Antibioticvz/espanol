import { readFileSync } from 'node:fs'
import { ParserService, computeStats } from '../../core/parser/parser.service'
import { MockSayService } from '../../core/tts/mock-say.service'
import { ElevenLabsService } from '../../core/tts/eleven-labs.service'
import type { TTSProvider } from '../../core/tts/tts-provider'
import { applyTaskResult, buildLessonSkeleton, flattenToTasks, markId3Written } from '../../core/queue/build-items'
import { GenerationQueue } from '../../core/queue/generation-queue'
import { FileService } from '../../core/file/file.service'
import { CostCalculator } from '../../core/cost/cost-calculator'
import { DEFAULT_PRICING } from '../../core/types/settings'
import type { LessonJson, VoiceRef } from '../../core/types/lesson-json'
import type { GenerationTask, QueueConfig } from '../../core/types/generation'
import { getSharedSchemaPath } from '../../core/util/paths'
import { boolFlag, numFlag, strFlag, type CliFlags } from '../args'

/**
 * `cli generate --input <файл> --provider mock_say|elevenlabs --out <папка> [--export-zip] [опции]`
 * (D-10) — headless-генерация без Electron. Это ЕДИНСТВЕННЫЙ путь, который реально тратит деньги
 * при provider=elevenlabs — но НИКОГДА не вызывается тестами (см. правило №1 CLAUDE.md); для
 * тестов/CI используется provider=mock_say (см. scripts/integration-test.mjs в корне монорепо).
 *
 * Резюмируемость: если <out>/<topic_id>/lesson.json уже существует, генерация продолжает его
 * (обрабатывает только pending/failed — см. GenerationQueue), а не начинает заново.
 * Ctrl+C сохраняет прогресс перед выходом (docs/SPEC_COMBINE.md §9.1).
 */
export async function runGenerate(flags: CliFlags): Promise<number> {
  const input = strFlag(flags, 'input')
  const outRoot = strFlag(flags, 'out')
  const providerName = strFlag(flags, 'provider') ?? 'mock_say'

  if (!input || !outRoot) {
    console.error('Использование: generate --input <файл> --provider mock_say|elevenlabs --out <папка> [--export-zip]')
    return 1
  }
  if (providerName !== 'mock_say' && providerName !== 'elevenlabs') {
    console.error(`Неизвестный provider "${providerName}". Допустимо: mock_say, elevenlabs.`)
    return 1
  }

  let raw: string
  try {
    raw = readFileSync(input, 'utf8')
  } catch (e) {
    console.error(`Не удалось прочитать входной файл ${input}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  const parseResult = new ParserService().parse(raw)
  if (parseResult.warnings.length > 0) {
    console.warn(`Предупреждения парсера (${parseResult.warnings.length}):`)
    for (const w of parseResult.warnings) console.warn(`  ⚠ ${w.line !== null ? `строка ${w.line}: ` : ''}${w.message}`)
  }
  if (parseResult.errors.length > 0 || !parseResult.lesson) {
    console.error(`Ошибки парсера (${parseResult.errors.length}) — генерация отменена:`)
    for (const e of parseResult.errors) console.error(`  ✗ ${e.line !== null ? `строка ${e.line}: ` : ''}${e.message}`)
    return 1
  }
  const lesson = parseResult.lesson

  const model = strFlag(flags, 'model') ?? (providerName === 'mock_say' ? 'macos_say' : 'eleven_multilingual_v2')
  const queueConfig: QueueConfig = {
    concurrency: Math.min(5, Math.max(1, numFlag(flags, 'concurrency', 3))),
    maxRetries: numFlag(flags, 'max-retries', 3),
    delayMs: numFlag(flags, 'delay-ms', 100),
    timeoutMs: numFlag(flags, 'timeout-ms', 30000)
  }
  const stability = flags.stability !== undefined ? numFlag(flags, 'stability', 0.5) : null
  const similarityBoost = flags['similarity-boost'] !== undefined ? numFlag(flags, 'similarity-boost', 0.75) : null
  const seed = flags.seed !== undefined ? numFlag(flags, 'seed', 0) : null

  let provider: TTSProvider
  if (providerName === 'mock_say') {
    provider = new MockSayService()
  } else {
    const apiKey = strFlag(flags, 'api-key') ?? process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      console.error('Для provider=elevenlabs укажите ключ: --api-key <ключ> или переменная окружения ELEVENLABS_API_KEY.')
      return 1
    }
    provider = new ElevenLabsService({ apiKey, maxRetries: queueConfig.maxRetries })
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
      return 1
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

  const audioRoot = fileService.lessonDir(outRoot, topicId)
  const tasks: GenerationTask[] = flattenToTasks(lessonJson, audioRoot, { es: voiceEs, ru: voiceRu })
  console.log(`К озвучке: ${tasks.length} элемент(ов) (провайдер=${providerName}, модель=${model}).`)

  const pricing = new CostCalculator(DEFAULT_PRICING)
  const pricePerThousand = pricing.priceForModel(model)
  const addId3 = !boolFlag(flags, 'no-id3')
  const startedAt = Date.now()

  const applyAndPersist = async (): Promise<void> => {
    for (const t of tasks) {
      applyTaskResult(lessonJson, t)
      if (addId3 && t.status === 'done') markId3Written(lessonJson, t)
    }
    try {
      await fileService.writeLessonJson(outRoot, topicId, lessonJson)
    } catch (e) {
      console.warn(`⚠ Не удалось сохранить промежуточный lesson.json: ${e instanceof Error ? e.message : String(e)}`)
    }
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

  let lastPersist: Promise<void> = Promise.resolve()
  queue.on('progress', (event) => {
    if (event.logLine) console.log(event.logLine)
    // Персистим lesson.json на КАЖДОЕ завершение задачи целиком (done/failed без lang — см.
    // класс-докстринг GenerationQueue), а не на каждый под-шаг ES/RU — идемпотентность и
    // устойчивость к падению процесса посреди долгой генерации (docs/SPEC_COMBINE.md §9).
    if (event.item && !event.item.lang && (event.item.status === 'done' || event.item.status === 'failed')) {
      lastPersist = applyAndPersist()
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
  await lastPersist
  process.off('SIGINT', onSigint)

  await applyAndPersist()

  const totalCharacters = tasks.reduce((sum, t) => sum + (t.esCharacters ?? 0) + (t.ruCharacters ?? 0), 0)
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
    return 1
  }
  return summary.failedItems > 0 ? 1 : 0
}
