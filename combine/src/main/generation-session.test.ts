import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NodeID3 from 'node-id3'
import { FileService } from '../core/file/file.service'
import { SettingsService } from '../core/settings/settings.service'
import { UnavailableEncryptor } from '../core/settings/encryptor'
import { createDefaultSettings } from '../core/types/settings'
import type { GenerationProgressEvent } from '../core/types/generation'
import type { LessonJson } from '../core/types/lesson-json'
import { getSharedSchemaPath } from '../core/util/paths'
import { ParserService } from '../core/parser/parser.service'

// getSharedSchemaPath() резолвит путь относительно СВОЕГО СОБСТВЕННОГО расположения
// (src/core/util/paths.ts), а не относительно вызывающего файла — специально, чтобы избежать
// именно того класса багов, где кто-то (правильно для core/tts/core/file, но неверно для
// src/main/, у которого на один уровень вложенности меньше) копирует "../../../../shared/...".
const SCHEMA_PATH = getSharedSchemaPath()

// vi.hoisted — фабрика vi.mock() поднимается над импортами, поэтому мутируемое состояние мока
// (какой AppContext сейчас "текущий") должно быть объявлено через vi.hoisted(), а не обычной
// переменной модуля.
const { getAppContextMock } = vi.hoisted(() => ({ getAppContextMock: vi.fn() }))
vi.mock('./services-bootstrap', () => ({ getAppContext: getAppContextMock }))

// Импортируем ПОСЛЕ vi.mock — GenerationSession обращается к getAppContext() лениво (внутри
// методов, не на верхнем уровне модуля), так что порядок здесь не критичен, но так яснее.
const { GenerationSession } = await import('./generation-session')

const MINI_LESSON = `#TOPIC 77 | Тест сессии
##BLOCK vocabulary | Слова
el gato | кот
la casa | дом
`

function waitFor(predicate: () => boolean, timeoutMs = 15000, intervalMs = 20): Promise<void> {
  const startedAt = Date.now()
  return new Promise((resolveWait, rejectWait) => {
    const tick = (): void => {
      if (predicate()) return resolveWait()
      if (Date.now() - startedAt > timeoutMs) return rejectWait(new Error('waitFor: таймаут ожидания условия'))
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

describe('GenerationSession (main/**, реальный MockSayService — бесплатно, локально, без сети)', () => {
  let workDir: string
  let outputDir: string
  let fileService: FileService

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-session-'))
    outputDir = join(workDir, 'lessons')
    fileService = new FileService(SCHEMA_PATH)
    const settingsService = new SettingsService(join(workDir, 'userData'), new UnavailableEncryptor())
    getAppContextMock.mockReturnValue({ fileService, settingsService, defaultOutputDir: outputDir })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  function settingsFor(overrides: Partial<ReturnType<typeof createDefaultSettings>> = {}) {
    return { ...createDefaultSettings(outputDir), provider: 'mock_say' as const, outputDir, ...overrides }
  }

  it('isActive() — false до старта, true во время генерации, false снова после истинного завершения', async () => {
    const session = new GenerationSession()
    expect(session.isActive()).toBe(false)

    const events: GenerationProgressEvent[] = []
    const { topicId } = await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, (e) => events.push(e))
    expect(session.isActive()).toBe(true)

    await waitFor(() => !session.isActive())

    expect(events.some((e) => e.runState === 'done')).toBe(true)
    const lessonJson = (await fileService.readLessonJson(outputDir, topicId)) as LessonJson
    expect(lessonJson.blocks[0].type).toBe('vocabulary')
    if (lessonJson.blocks[0].type === 'vocabulary') {
      expect(lessonJson.blocks[0].words.every((w) => w.status === 'done')).toBe(true)
    }
    // finalize() реально досчитал финальную статистику, а не оставил null/0 по умолчанию.
    expect(lessonJson.stats.generation_duration_seconds).not.toBeNull()
    expect(lessonJson.stats.file_size_mb).toBeGreaterThan(0)
  }, 30000)

  it('РЕГРЕССИЯ (issue #3): start() бросает, если сессия уже isActive() — не даёт перезаписать активную очередь/lessonJson', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    expect(session.isActive()).toBe(true)

    await expect(session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)).rejects.toThrow(
      /уже выполняется/
    )
    await expect(
      session.startRegenerate(
        { topicId: '77-test-sessii', outputRoot: outputDir, mode: 'all', queueConfig: settingsFor().queue, pricePerThousandChars: {} },
        () => undefined
      )
    ).rejects.toThrow(/уже выполняется/)

    await waitFor(() => !session.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (issue #2): resume() возвращает управление немедленно, не дожидаясь конца генерации', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    session.pause()
    await waitFor(() => true, 50) // маленькая пауза, чтобы pause() гарантированно применился

    const startedAt = Date.now()
    session.resume()
    const elapsedMs = Date.now() - startedAt
    // resume() теперь синхронна и не ждёт onIdle() всей очереди — раньше здесь можно было
    // прождать секунды/минуты генерации целиком (issue #2, второй раунд ревью).
    expect(elapsedMs).toBeLessThan(200)

    await waitFor(() => !session.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (issue #2): finalize срабатывает РОВНО ОДИН РАЗ даже после цикла pause->resume (не преждевременно на паузе, не пропущен после резюме)', async () => {
    const session = new GenerationSession()
    const events: GenerationProgressEvent[] = []
    const { topicId } = await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, (e) => events.push(e))

    session.pause()
    await waitFor(() => true, 30)
    session.resume()
    await waitFor(() => !session.isActive())

    // runState='done' должен встретиться РОВНО один раз за всю сессию.
    const doneEvents = events.filter((e) => e.runState === 'done')
    expect(doneEvents).toHaveLength(1)

    // generation.log должен содержать запись о завершении РОВНО один раз (finalize пишет её один раз).
    const log = await readFile(join(fileService.lessonDir(outputDir, topicId), 'generation.log'), 'utf8')
    const completionLines = log.split('\n').filter((l) => l.includes('Генерация завершена'))
    expect(completionLines).toHaveLength(1)
  }, 30000)

  it('actual_cost_usd считается по ВСЕМ done-элементам lesson.json при резюме (issue #8)', async () => {
    const session = new GenerationSession()
    const pricing = { macos_say: 1 } // 1$/1000 символов — специально ненулевая цена для проверки арифметики
    await session.start({ inputText: MINI_LESSON, settings: settingsFor({ pricePerThousandChars: pricing }) }, () => undefined)
    await waitFor(() => !session.isActive())

    const lessonJson = await fileService.readLessonJson(outputDir, '77-test-sessii')
    // "el gato"(7)+"кот"(3)+"la casa"(7)+"дом"(3) = 20 символов -> 20/1000*1 = 0.02
    expect(lessonJson.stats.actual_cost_usd).toBeCloseTo(0.02, 4)

    // Резюмируем (startRegenerate 'failed' на уже всё done уроке — не должен ничего пересчитать
    // на 0, а обязан взять стоимость по ВСЕМ элементам, а не только по "новым" tasks текущей сессии).
    const session2 = new GenerationSession()
    await session2.startRegenerate(
      { topicId: '77-test-sessii', outputRoot: outputDir, mode: 'failed', queueConfig: settingsFor().queue, pricePerThousandChars: pricing },
      () => undefined
    )
    await waitFor(() => !session2.isActive())
    const lessonJson2 = await fileService.readLessonJson(outputDir, '77-test-sessii')
    expect(lessonJson2.stats.actual_cost_usd).toBeCloseTo(0.02, 4)
  }, 30000)

  it('start() возвращает {topicId, lesson} (не только topicId) — нужно плоскому combineApi.startGeneration (D-22)', async () => {
    const session = new GenerationSession()
    const { topicId, lesson } = await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    expect(topicId).toBe('77-test-sessii')
    expect(lesson.topic_id).toBe('77-test-sessii')
    expect(lesson.blocks[0].type).toBe('vocabulary')
    await waitFor(() => !session.isActive())
  }, 30000)

  it('startParsed() — вариант start() для уже разобранного ParsedLesson (плоский контракт shared/ipc.ts#startGeneration)', async () => {
    const parseResult = new ParserService().parse(MINI_LESSON)
    expect(parseResult.lesson).not.toBeNull()

    const session = new GenerationSession()
    const events: GenerationProgressEvent[] = []
    const { topicId, lesson } = await session.startParsed(
      { lesson: parseResult.lesson!, settings: settingsFor(), apiKey: null },
      (e) => events.push(e)
    )
    expect(topicId).toBe('77-test-sessii')
    expect(lesson.topic_id).toBe('77-test-sessii')
    expect(session.isActive()).toBe(true)

    await waitFor(() => !session.isActive())
    expect(events.some((e) => e.runState === 'done')).toBe(true)
    const onDisk = await fileService.readLessonJson(outputDir, topicId)
    if (onDisk.blocks[0].type === 'vocabulary') {
      expect(onDisk.blocks[0].words.every((w) => w.status === 'done')).toBe(true)
    }
  }, 30000)

  it('startRegenerate() теперь тоже возвращает {topicId, lesson} (симметрично start()/startParsed())', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    await waitFor(() => !session.isActive())

    const session2 = new GenerationSession()
    const result = await session2.startRegenerate(
      { topicId: '77-test-sessii', outputRoot: outputDir, mode: 'all', queueConfig: settingsFor().queue, pricePerThousandChars: {} },
      () => undefined
    )
    expect(result.topicId).toBe('77-test-sessii')
    expect(result.lesson.topic_id).toBe('77-test-sessii')
    await waitFor(() => !session2.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью, TOCTOU): второй перекрывающийся start() бросает СРАЗУ, не дожидаясь первого await первого вызова', async () => {
    const session = new GenerationSession()
    // Оба вызова инициируются в ОДНОМ тике — без await между ними. До фикса (this.starting)
    // isActive() полагалась только на this.queue (присваивается лишь в самом конце startCommon,
    // после кучи await), поэтому второй вызов тоже проходил guard и получались ДВЕ живые очереди.
    const p1 = session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    const p2 = session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)

    await expect(p2).rejects.toThrow(/уже выполняется/)
    await p1
    await waitFor(() => !session.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью, TOCTOU): startRegenerate() тоже отклоняет перекрывающийся вызов немедленно', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    await waitFor(() => !session.isActive())

    const regenParams = {
      topicId: '77-test-sessii',
      outputRoot: outputDir,
      mode: 'all' as const,
      queueConfig: settingsFor().queue,
      pricePerThousandChars: {}
    }
    const p1 = session.startRegenerate(regenParams, () => undefined)
    const p2 = session.startRegenerate(regenParams, () => undefined)
    await expect(p2).rejects.toThrow(/уже выполняется/)
    await p1
    await waitFor(() => !session.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью): cancel() освобождает isActive() — новый start() возможен сразу после await cancel(), без перезапуска приложения', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    expect(session.isActive()).toBe(true)

    // Раньше: GenerationQueue эмитит runState==='done' ТОЛЬКО при истинном завершении, а finalize()
    // (единственное место, обнулявшее this.queue) триггерился только этим событием — после cancel()
    // 'done' никогда не приходило, isActive() оставался true навсегда (до перезапуска процесса).
    await session.cancel()
    expect(session.isActive()).toBe(false)

    // Новый старт должен пройти БЕЗ "Генерация уже выполняется" — именно это было заклинено багом.
    const { topicId } = await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    expect(topicId).toBe('77-test-sessii')
    await waitFor(() => !session.isActive())
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью): startRegenerate() НЕ портит lesson.json, если createProvider() бросает (elevenlabs без сохранённого ключа)', async () => {
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, () => undefined)
    await waitFor(() => !session.isActive())

    // Симулируем "урок был сгенерирован elevenlabs" (в этом тестовом окружении ключ никогда не
    // сохранён — UnavailableEncryptor, см. beforeEach — так что createProvider('elevenlabs', ...)
    // гарантированно бросит "API-ключ не задан").
    const lessonJsonPath = fileService.lessonJsonPath(outputDir, '77-test-sessii')
    const before = JSON.parse(await readFile(lessonJsonPath, 'utf8')) as LessonJson
    before.config.provider = 'elevenlabs'
    await writeFile(lessonJsonPath, JSON.stringify(before), 'utf8')

    const session2 = new GenerationSession()
    await expect(
      session2.startRegenerate(
        { topicId: '77-test-sessii', outputRoot: outputDir, mode: 'all', queueConfig: settingsFor().queue, pricePerThousandChars: {} },
        () => undefined
      )
    ).rejects.toThrow(/API-ключ/)

    // РАНЬШЕ: resetItemStatus+writeLessonJson шли ДО createProvider() — неудавшийся вызов уже
    // необратимо стирал все done-метки полностью готового урока. Теперь lesson.json должен
    // остаться НЕТРОНУТЫМ (все статусы всё ещё 'done') после отклонённого вызова.
    const after = JSON.parse(await readFile(lessonJsonPath, 'utf8')) as LessonJson
    if (after.blocks[0].type === 'vocabulary') {
      expect(after.blocks[0].words.every((w) => w.status === 'done')).toBe(true)
    } else {
      throw new Error('unexpected block type in test fixture')
    }
    expect(session2.isActive()).toBe(false) // сессия не должна остаться "занятой" после отклонённого вызова
  }, 30000)

  it('РЕГРЕССИЯ (минор — гибрид конфигов): при резюме start() берёт голос из СОХРАНЁННОГО lessonJson.config, а не из подменённых текущих settings (иначе смешение голосов внутри урока)', async () => {
    const originalSettings = settingsFor({ voiceEs: { id: 'Mónica', name: 'Mónica' }, voiceRu: { id: 'Milena', name: 'Milena' } })
    const session = new GenerationSession()
    await session.start({ inputText: MINI_LESSON, settings: originalSettings }, () => undefined)
    await waitFor(() => !session.isActive())

    // Помечаем один элемент как failed, чтобы повторный импорт того же текста реально пере-озвучил его.
    const lessonJsonPath = fileService.lessonJsonPath(outputDir, '77-test-sessii')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8')) as LessonJson
    if (lessonJson.blocks[0].type !== 'vocabulary') throw new Error('unexpected block type in test fixture')
    const retriedWord = lessonJson.blocks[0].words[0]
    retriedWord.status = 'failed'
    retriedWord.error = 'искусственный сбой для теста'
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    // "Переключаем" ТЕКУЩИЕ настройки на другой голос ES перед повторным импортом того же текста —
    // раньше resolveVoices() вызывался с ЭТИМИ (текущими) настройками ДО проверки resuming.
    const differentSettings = settingsFor({ voiceEs: { id: 'Milena', name: 'Milena' }, voiceRu: { id: 'Milena', name: 'Milena' } })
    const session2 = new GenerationSession()
    await session2.start({ inputText: MINI_LESSON, settings: differentSettings }, () => undefined)
    await waitFor(() => !session2.isActive())

    const wordAudioPath = join(fileService.lessonDir(outputDir, '77-test-sessii'), 'audio', 'es', `${retriedWord.id}.mp3`)
    const tags = await NodeID3.Promise.read(wordAudioPath)
    // ID3 artist = имя ГОЛОСА, которым реально озвучена фраза (см. runQueue#onAudioSaved) — должно
    // быть Mónica (из СОХРАНЁННОГО config), а не Milena (из подменённых текущих settings).
    expect(tags.artist).toBe('Mónica')
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью): getActiveSnapshot() позволяет пересозданному окну переподключиться к уже идущему прогону', async () => {
    const session = new GenerationSession()
    expect(session.getActiveSnapshot()).toBeNull()

    const events: GenerationProgressEvent[] = []
    const { topicId } = await session.start({ inputText: MINI_LESSON, settings: settingsFor() }, (e) => events.push(e))

    const snapshot = session.getActiveSnapshot()
    expect(snapshot).not.toBeNull()
    expect(snapshot?.topicId).toBe(topicId)
    expect(snapshot?.lesson.topic_id).toBe(topicId)
    expect(['running', 'paused']).toContain(snapshot?.runState)

    await waitFor(() => !session.isActive())
    // После истинного завершения снимка больше нет — сессия свободна для нового старта.
    expect(session.getActiveSnapshot()).toBeNull()
  }, 30000)
})
