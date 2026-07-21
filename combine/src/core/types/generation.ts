import type { BlockType, ItemStatus } from './lesson-json'

export type Lang = 'es' | 'ru'

/**
 * Один рабочий элемент очереди — одна фраза/слово/рассказ ЦЕЛИКОМ (ES+RU вместе).
 * Так статус (ItemStatus) остаётся атомарным на весь элемент, как того требует схема
 * (phrase.status — одно поле, не отдельно по языкам): задача внутри себя озвучивает
 * сперва ES, затем RU последовательно, и лишь после обоих успешных результатов
 * помечается done. См. обсуждение в generation-queue.ts.
 */
export interface GenerationTask {
  /** id фразы в lesson.json, напр. 04-b1-llamarse-01, либо синтетический для story: 04-b4-story */
  phraseId: string
  blockId: string
  blockType: BlockType
  /** null для vocabulary/story (там группировки нет) */
  groupKey: string | null
  esText: string
  ruText: string
  esOutPath: string
  ruOutPath: string
  esVoiceId: string
  esVoiceName: string
  ruVoiceId: string
  ruVoiceName: string

  status: ItemStatus
  error: string | null
  esDurationMs: number | null
  ruDurationMs: number | null
  esCharacters: number | null
  ruCharacters: number | null
}

export interface QueueConfig {
  /** 1–5 одновременных фраз (каждая — до 2 последовательных запросов ES→RU) */
  concurrency: number
  /** мс задержки перед каждым отдельным TTS-запросом */
  delayMs: number
  /** мс на один запрос (используется провайдером для таймаута) */
  timeoutMs: number
  /** 1–10 — максимум повторов на 429/5xx/timeout (используется провайдером для backoff) */
  maxRetries: number
}

export type QueueRunState = 'idle' | 'running' | 'paused' | 'cancelled' | 'done'

export interface GenerationProgressEvent {
  runState: QueueRunState
  totalItems: number
  doneItems: number
  failedItems: number
  pendingItems: number
  generatingItems: number
  currentItemId: string | null
  currentText: string | null
  elapsedMs: number
  speedPerMin: number
  etaSeconds: number | null
  spentUsd: number
  item?: {
    phraseId: string
    lang?: Lang
    status: ItemStatus
    error?: string | null
    durationMs?: number | null
  }
  logLine?: string
}
