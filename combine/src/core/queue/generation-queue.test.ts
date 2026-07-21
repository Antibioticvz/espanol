import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TTSProvider, TtsModel, TtsSynthesizeParams, TtsSynthesizeResult, TtsVoice } from '../tts/tts-provider'
import { TtsError } from '../tts/tts-provider'
import type { GenerationTask } from '../types/generation'
import { GenerationQueue } from './generation-queue'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class FakeProvider implements TTSProvider {
  readonly id = 'mock_say' as const
  calls: string[] = []
  maxConcurrentSeen = 0
  private inFlight = 0

  constructor(private readonly opts: { delayMs?: number; failTexts?: Set<string> } = {}) {}

  async listVoices(): Promise<TtsVoice[]> {
    return []
  }

  async listModels(): Promise<TtsModel[]> {
    return []
  }

  async synthesize(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult> {
    this.inFlight += 1
    this.maxConcurrentSeen = Math.max(this.maxConcurrentSeen, this.inFlight)
    this.calls.push(params.text)
    try {
      if (this.opts.delayMs) await sleep(this.opts.delayMs)
      if (this.opts.failTexts?.has(params.text)) {
        throw new TtsError('искусственная ошибка теста', 'server', 500, true)
      }
      return { audio: Buffer.from(`mp3:${params.text}`), durationMs: 42, characters: params.text.length }
    } finally {
      this.inFlight -= 1
    }
  }
}

function makeTask(dir: string, id: string, overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    phraseId: id,
    blockId: 'b1',
    blockType: 'vocabulary',
    groupKey: null,
    esText: `es-${id}`,
    ruText: `ru-${id}`,
    esOutPath: join(dir, 'audio', 'es', `${id}.mp3`),
    ruOutPath: join(dir, 'audio', 'ru', `${id}.mp3`),
    esVoiceId: 'Mónica',
    esVoiceName: 'Mónica',
    ruVoiceId: 'Milena',
    ruVoiceName: 'Milena',
    status: 'pending',
    error: null,
    esDurationMs: null,
    ruDurationMs: null,
    esCharacters: null,
    ruCharacters: null,
    ...overrides
  }
}

const CONFIG = { concurrency: 3, delayMs: 0, timeoutMs: 5000, maxRetries: 3 }
const CTX = { modelId: 'macos_say', stability: null, similarityBoost: null, seed: null }

describe('GenerationQueue', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'combine-queue-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('обрабатывает все задачи и пишет ES+RU файлы на диск', async () => {
    const tasks = [makeTask(dir, 'p1'), makeTask(dir, 'p2')]
    const provider = new FakeProvider()
    const queue = new GenerationQueue(tasks, CONFIG, provider, CTX)
    await queue.start()

    expect(tasks.every((t) => t.status === 'done')).toBe(true)
    expect(queue.getRunState()).toBe('done')
    const esBuf = await readFile(tasks[0].esOutPath, 'utf8')
    expect(esBuf).toBe('mp3:es-p1')
    const ruBuf = await readFile(tasks[1].ruOutPath, 'utf8')
    expect(ruBuf).toBe('mp3:ru-p2')
    expect([...provider.calls].sort()).toEqual(['es-p1', 'es-p2', 'ru-p1', 'ru-p2'].sort())
  })

  it('уважает concurrency — не запускает больше задач одновременно, чем настроено', async () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(dir, `p${i}`))
    const provider = new FakeProvider({ delayMs: 15 })
    const queue = new GenerationQueue(tasks, { ...CONFIG, concurrency: 2 }, provider, CTX)
    await queue.start()

    expect(provider.maxConcurrentSeen).toBeLessThanOrEqual(2)
    expect(tasks.every((t) => t.status === 'done')).toBe(true)
  })

  it('пауза останавливает выдачу новых задач; резюме продолжает и завершает все', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => makeTask(dir, `p${i}`))
    const provider = new FakeProvider({ delayMs: 20 })
    const queue = new GenerationQueue(tasks, { ...CONFIG, concurrency: 1 }, provider, CTX)

    const runPromise = queue.start()
    await sleep(10) // первая задача уже в процессе (ES)
    queue.pause()
    expect(queue.getRunState()).toBe('paused')

    const callsAtPause = provider.calls.length
    await sleep(60) // дождаться, пока текущая (в процессе) задача точно завершится
    // Пока на паузе, новые задачи не должны стартовать — число вызовов не растёт дальше того,
    // что нужно было для завершения уже стартовавшей задачи (максимум ES+RU = +1 к моменту паузы).
    const callsAfterWait = provider.calls.length
    expect(callsAfterWait).toBeLessThanOrEqual(callsAtPause + 1)

    await queue.resume()
    await runPromise.catch(() => undefined)
    // resume() сам по себе не ждёт runPromise (это исходный start()) — дождёмся явно завершения через onIdle-эквивалент
    while (tasks.some((t) => t.status === 'pending' || t.status === 'generating')) {
      await sleep(10)
    }
    expect(tasks.every((t) => t.status === 'done')).toBe(true)
  })

  it('идемпотентность: задачи со статусом done не переобрабатываются (кэш по статусу — см. build-items.ts)', async () => {
    // status='done' имитирует ранее (в предыдущем запуске) завершённую фразу — очередь ориентируется
    // только на status (готовые файлы уже на диске из прошлого запуска, здесь не воссоздаются).
    const doneTask = makeTask(dir, 'already-done', { status: 'done', esDurationMs: 999, ruDurationMs: 999 })
    const pendingTask = makeTask(dir, 'to-do')
    const tasks = [doneTask, pendingTask]

    const provider = new FakeProvider()
    const queue = new GenerationQueue(tasks, CONFIG, provider, CTX)
    await queue.start()

    expect(provider.calls).not.toContain('es-already-done')
    expect(provider.calls).not.toContain('ru-already-done')
    expect(provider.calls).toContain('es-to-do')
    expect(doneTask.esDurationMs).toBe(999) // не тронуто
    expect(pendingTask.status).toBe('done')
  })

  it('resume() после ошибок повторяет только failed (done остаются нетронутыми)', async () => {
    const tasks = [makeTask(dir, 'ok'), makeTask(dir, 'bad')]
    const provider = new FakeProvider({ failTexts: new Set(['es-bad']) })
    const queue = new GenerationQueue(tasks, CONFIG, provider, CTX)
    await queue.start()

    expect(tasks[0].status).toBe('done')
    expect(tasks[1].status).toBe('failed')

    // "Чиним" провайдера (как если бы временная ошибка исчезла) и резюмируем
    const fixedProvider = new FakeProvider()
    const queue2 = new GenerationQueue(tasks, CONFIG, fixedProvider, CTX)
    await queue2.resume()
    // resume() из idle не запускает ничего — используем start() напрямую т.к. это новый объект очереди
    await queue2.start()

    expect(tasks[1].status).toBe('done')
    expect(fixedProvider.calls).not.toContain('es-ok') // done-задача не переигрывается новым экземпляром очереди
  })

  it('cancel() переводит очередь в состояние cancelled и не запускает ещё не начатые задачи', async () => {
    const tasks = Array.from({ length: 4 }, (_, i) => makeTask(dir, `p${i}`))
    const provider = new FakeProvider({ delayMs: 30 })
    const queue = new GenerationQueue(tasks, { ...CONFIG, concurrency: 1 }, provider, CTX)

    const runPromise = queue.start()
    await sleep(10)
    queue.cancel()
    expect(queue.getRunState()).toBe('cancelled')
    await runPromise.catch(() => undefined)
    await sleep(50)

    const notPending = tasks.filter((t) => t.status !== 'pending')
    // Как минимум одна задача (уже стартовавшая на момент cancel) успела завершиться; остальные остались pending.
    expect(notPending.length).toBeGreaterThanOrEqual(1)
    expect(tasks.some((t) => t.status === 'pending')).toBe(true)
  })

  it('считает live-стоимость (spentUsd) по фактическим символам и цене за 1000 символов', async () => {
    const tasks = [makeTask(dir, 'p1')] // esText='es-p1' (5 симв.), ruText='ru-p1' (5 симв.)
    const provider = new FakeProvider()
    const queue = new GenerationQueue(tasks, CONFIG, provider, CTX, { pricePerThousandChars: 100 })
    await queue.start()
    // 10 символов всего * (100/1000) = 1.0
    expect(queue.getSpentUsd()).toBeCloseTo(1.0, 5)
  })
})
