import { EventEmitter } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type PQueue from 'p-queue'
import type { GenerationProgressEvent, GenerationTask, Lang, QueueConfig, QueueRunState } from '../types/generation'
import type { TTSProvider } from '../tts/tts-provider'

export interface SynthesizeContext {
  modelId: string
  stability: number | null
  similarityBoost: number | null
  seed: number | null
}

export type OnAudioSaved = (task: GenerationTask, lang: Lang, filePath: string, durationMs: number) => Promise<void> | void

export interface GenerationQueueOptions {
  onAudioSaved?: OnAudioSaved
  /** Цена за 1000 символов текущей модели (из настроек) — для live-оценки "Потрачено: $X". */
  pricePerThousandChars?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Очередь генерации (p-queue) — concurrency/задержка/таймаут, пауза/отмена/возобновление,
 * идемпотентность (status=done не пересоздаётся), события прогресса для renderer через IPC.
 *
 * ВАЖНО про гранулярность задач: один GenerationTask = одна фраза/слово/рассказ ЦЕЛИКОМ
 * (и ES, и RU), а не два отдельных элемента. Причина: схема lesson.json хранит один `status`
 * на фразу (не по языкам отдельно), поэтому задача синтезирует ES, затем RU ПОСЛЕДОВАТЕЛЬНО
 * и лишь по завершении обоих помечает себя done/failed — это единственный способ оставить
 * `status` атомарным и при этом не переусложнять контракт доп. состоянием, которого нет в схеме.
 * "concurrency" (1–5) — это число одновременно обрабатываемых ФРАЗ (до 2 последовательных
 * запросов внутри каждой), что соответствует "параллельные запросы" в §4.2 спеки при разумной
 * осторожности к рейт-лимитам.
 *
 * p-queue — ESM-only пакет; см. src/core/util/wav-mp3.ts про динамический import() и почему.
 * Здесь используется `import type` (стирается компилятором, не создаёт require()) + динамический
 * import() в getQueue() для самого рантайм-конструктора.
 */
export class GenerationQueue extends EventEmitter {
  private readonly tasks: GenerationTask[]
  private readonly config: QueueConfig
  private readonly provider: TTSProvider
  private readonly ctx: SynthesizeContext
  private readonly onAudioSaved?: OnAudioSaved
  private readonly pricePerThousandChars: number

  private pQueue: PQueue | null = null
  private runState: QueueRunState = 'idle'
  private startedAt = 0
  private spentUsd = 0
  /**
   * phraseId'ы задач, чей runTask() СЕЙЧАС физически выполняется (между входом в функцию и
   * finally). Источник истины отдельно от GenerationTask.status — см. CRITICAL-фикс в start():
   * status одной и той же задачи мог быть сброшен в 'pending' (напр. историческим кодом pause()),
   * но это НЕ значит, что реальный synthesize()/writeFile() уже прекратился — JS-промис
   * runTask() продолжает выполняться в фоне независимо от того, что мы делаем с полем status.
   * Если start()/resume() полагается только на status для решения "что добавить в очередь",
   * при concurrency ≥ 2 может найтись свободный слот concurrency, куда допишется ВТОРОЙ,
   * параллельный вызов runTask() для ТОЙ ЖЕ задачи, пока первый ещё не закончил — двойной
   * платный запрос и гонка двух writeFile()/NodeID3.write() в один и тот же mp3 (порча файла).
   * inFlight — единственный надёжный признак "не трогать, физически уже выполняется".
   */
  private readonly inFlight = new Set<string>()

  constructor(tasks: GenerationTask[], config: QueueConfig, provider: TTSProvider, ctx: SynthesizeContext, opts: GenerationQueueOptions = {}) {
    super()
    this.tasks = tasks
    this.config = config
    this.provider = provider
    this.ctx = ctx
    this.onAudioSaved = opts.onAudioSaved
    this.pricePerThousandChars = opts.pricePerThousandChars ?? 0
  }

  getTasks(): readonly GenerationTask[] {
    return this.tasks
  }

  getRunState(): QueueRunState {
    return this.runState
  }

  getSpentUsd(): number {
    return this.spentUsd
  }

  private async getQueue(): Promise<PQueue> {
    if (this.pQueue) return this.pQueue
    const { default: PQueueCtor } = await import('p-queue')
    this.pQueue = new PQueueCtor({ concurrency: this.config.concurrency })
    return this.pQueue
  }

  private snapshotCounts(): { pending: number; generating: number; done: number; failed: number } {
    let pending = 0
    let generating = 0
    let done = 0
    let failed = 0
    for (const t of this.tasks) {
      if (t.status === 'pending') pending += 1
      else if (t.status === 'generating') generating += 1
      else if (t.status === 'done') done += 1
      else failed += 1
    }
    return { pending, generating, done, failed }
  }

  private emitProgress(partial: Partial<GenerationProgressEvent> = {}): void {
    const counts = this.snapshotCounts()
    const elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0
    const speedPerMin = elapsedMs > 0 ? counts.done / (elapsedMs / 60000) : 0
    const remaining = counts.pending + counts.generating
    const etaSeconds = speedPerMin > 0 ? Math.round((remaining / speedPerMin) * 60) : null
    const event: GenerationProgressEvent = {
      runState: this.runState,
      totalItems: this.tasks.length,
      doneItems: counts.done,
      failedItems: counts.failed,
      pendingItems: counts.pending,
      generatingItems: counts.generating,
      currentItemId: null,
      currentText: null,
      elapsedMs,
      speedPerMin,
      etaSeconds,
      spentUsd: this.spentUsd,
      ...partial
    }
    this.emit('progress', event)
  }

  /** Запускает обработку pending/failed задач. Идемпотентно: done не трогает и не пересоздаёт файлы. */
  async start(): Promise<void> {
    if (this.runState === 'running') return
    this.runState = 'running'
    if (!this.startedAt) this.startedAt = Date.now()
    const queue = await this.getQueue()
    queue.concurrency = this.config.concurrency
    if (queue.isPaused) queue.start()

    // !this.inFlight.has(...) — см. докстринг поля inFlight выше: не переставляем в очередь
    // задачу, чей runTask() физически ещё выполняется, даже если её status почему-то 'pending'.
    const toRun = this.tasks.filter((t) => (t.status === 'pending' || t.status === 'failed') && !this.inFlight.has(t.phraseId))
    for (const task of toRun) {
      task.status = 'pending'
      task.error = null
      void queue.add(() => this.runTask(task))
    }
    this.emitProgress()
    await queue.onIdle()
    if (this.runState === 'running') {
      this.runState = 'done'
      this.emitProgress()
    }
  }

  /**
   * Останавливает выдачу НОВЫХ задач. Уже физически стартовавшие задачи доводятся до конца
   * (done/failed) САМИ — их status остаётся 'generating' до этого момента, мы его здесь
   * НЕ трогаем (см. CRITICAL-фикс выше и класс-докстринг поля inFlight): раньше pause() сбрасывал
   * 'generating'→'pending' для ВСЕХ текущих задач, что при concurrency ≥ 2 и наличии свободного
   * слота позволяло resume()→start() запустить ВТОРОЙ, параллельный runTask() для задачи, чей
   * первый вызов ещё не завершился — двойная генерация (двойные деньги у ElevenLabs, гонка двух
   * writeFile()/NodeID3.write() в один mp3). Теперь единственная защита от повторной постановки —
   * inFlight (see toRun в start()), а status='generating' во время паузы просто означает "уже
   * реально озвучивается, доиграет сам" — ЧЕСТНО отражает происходящее, а не выдаёт желаемое
   * (сброшенный pending) за действительное.
   *
   * queue.clear() всё равно обязателен — он убирает НЕ начатые задачи (никогда не входившие в
   * inFlight), которые predыдущий start() уже добавил в p-queue, но которые ещё ждут свободного
   * слота concurrency; без очистки resume()→start() добавил бы для них ВТОРУЮ копию.
   */
  pause(): void {
    if (this.runState !== 'running') return
    this.runState = 'paused'
    this.pQueue?.pause()
    this.pQueue?.clear()
    this.emitProgress()
  }

  /** Возобновление — берёт только pending+failed, физически не выполняющиеся (см. класс-докстринг). */
  async resume(): Promise<void> {
    if (this.runState !== 'paused' && this.runState !== 'cancelled') return
    await this.start()
  }

  /**
   * В отличие от pause(), cancel() СЕМАНТИЧЕСКИ финализирует незавершённые задачи как "не сделано":
   * runTask() проверяет `runState === 'cancelled'` после ES-половины и рано выходит, поэтому здесь
   * безопасно сразу пометить текущие 'generating' как 'pending' — тот самый ранний return в
   * runTask() гарантирует, что физически ещё выполняющийся вызов НЕ перезапишет это обратно
   * в 'done' сам. (При pause() такой гарантии нет — там in-flight просто доигрывает как обычно —
   * поэтому там мы status не трогаем, см. докстринг pause().)
   */
  cancel(): void {
    this.runState = 'cancelled'
    this.pQueue?.pause()
    this.pQueue?.clear()
    for (const t of this.tasks) {
      if (t.status === 'generating') t.status = 'pending'
    }
    this.emitProgress()
  }

  private async runTask(task: GenerationTask): Promise<void> {
    if (this.runState === 'cancelled') return
    // Идемпотентность/защита от двойной постановки в очередь (см. докстринг pause() выше):
    // если эта же задача каким-то образом уже выполнена — не переозвучиваем и не перезаписываем файл.
    if (task.status === 'done') return
    // inFlight помечаем ДО первого await — тем самым закрывая окно, в которое toRun (start())
    // мог бы посчитать эту же задачу "свободной" и добавить её в очередь повторно.
    this.inFlight.add(task.phraseId)
    try {
      task.status = 'generating'
      this.emitProgress({
        currentItemId: task.phraseId,
        currentText: task.esText,
        item: { phraseId: task.phraseId, status: 'generating' }
      })
      try {
        await this.synthesizeLang(task, 'es')
        if ((this.runState as QueueRunState) === 'cancelled') return
        await this.synthesizeLang(task, 'ru')
        task.status = 'done'
        task.error = null
        this.emitProgress({
          item: { phraseId: task.phraseId, status: 'done' },
          logLine: `[OK] ${task.phraseId} готово (ES ${task.esDurationMs ?? 0}мс, RU ${task.ruDurationMs ?? 0}мс)`
        })
      } catch (e) {
        task.status = 'failed'
        task.error = e instanceof Error ? e.message : String(e)
        this.emitProgress({
          item: { phraseId: task.phraseId, status: 'failed', error: task.error },
          logLine: `[FAIL] ${task.phraseId}: ${task.error}`
        })
      }
    } finally {
      this.inFlight.delete(task.phraseId)
    }
  }

  private async synthesizeLang(task: GenerationTask, lang: Lang): Promise<void> {
    if (this.config.delayMs > 0) await sleep(this.config.delayMs)
    const text = lang === 'es' ? task.esText : task.ruText
    const voiceId = lang === 'es' ? task.esVoiceId : task.ruVoiceId
    const outPath = lang === 'es' ? task.esOutPath : task.ruOutPath

    this.emitProgress({
      currentItemId: task.phraseId,
      currentText: text,
      item: { phraseId: task.phraseId, lang, status: 'generating' },
      logLine: `[..] ${task.phraseId} (${lang.toUpperCase()}) генерация…`
    })

    const result = await this.provider.synthesize({
      text,
      lang,
      voiceId,
      modelId: this.ctx.modelId,
      stability: this.ctx.stability,
      similarityBoost: this.ctx.similarityBoost,
      seed: this.ctx.seed,
      timeoutMs: this.config.timeoutMs
    })

    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, result.audio)

    if (lang === 'es') {
      task.esDurationMs = result.durationMs
      task.esCharacters = result.characters
    } else {
      task.ruDurationMs = result.durationMs
      task.ruCharacters = result.characters
    }
    this.spentUsd += (result.characters / 1000) * this.pricePerThousandChars

    if (this.onAudioSaved) await this.onAudioSaved(task, lang, outPath, result.durationMs)

    this.emitProgress({
      item: { phraseId: task.phraseId, lang, status: 'done', durationMs: result.durationMs },
      logLine: `[OK] ${task.phraseId} (${lang.toUpperCase()}) готово, ${result.durationMs}мс`
    })
  }
}
