import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService } from '../core/file/file.service'
import { SettingsService } from '../core/settings/settings.service'
import { UnavailableEncryptor } from '../core/settings/encryptor'
import { createDefaultSettings } from '../core/types/settings'
import type { GenerationProgressEvent } from '../core/types/generation'
import type { LessonJson } from '../core/types/lesson-json'
import { getSharedSchemaPath } from '../core/util/paths'

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
})
