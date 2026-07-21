import type { Lang } from '../types/generation'
import type { Provider } from '../types/lesson-json'

export interface TtsSynthesizeParams {
  text: string
  lang: Lang
  voiceId: string
  modelId: string
  stability?: number | null
  similarityBoost?: number | null
  seed?: number | null
  /** мс на запрос; провайдер сам обрывает и превращает в TtsError(kind:'timeout') */
  timeoutMs?: number
}

export interface TtsSynthesizeResult {
  audio: Buffer
  durationMs: number
  /** Фактически озвученные символы — основа для расчёта реальной стоимости */
  characters: number
  /**
   * v1.2 (D-23): заметка о нормализации громкости — ТОЛЬКО когда есть что сообщить (успех/сбой/
   * недоступность ffmpeg для ElevenLabs). mock_say всегда молча успешна (когда включена) и не
   * заполняет это поле — см. GenerationQueue, которая при наличии превращает это в лог-строку.
   */
  normalizationNote?: string | null
}

export interface TtsVoice {
  id: string
  name: string
  previewUrl: string | null
  category?: string | null
  labels?: Record<string, string>
}

export interface TtsModel {
  id: string
  name: string
}

export interface ResolvedVoice {
  id: string
  name: string
  usedFallback: boolean
  warning?: string
}

export interface TTSProvider {
  readonly id: Provider
  listVoices(): Promise<TtsVoice[]>
  listModels(): Promise<TtsModel[]>
  synthesize(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult>
  /**
   * Опционально: сверка предпочтительного voiceId с фактически доступными голосами
   * и graceful fallback (используется MockSayService — см. docs/DECISIONS.md D-04).
   * ElevenLabsService не переопределяет — voice_id там всегда непрозрачный и берётся из GET /v1/voices.
   */
  resolveVoice?(lang: Lang, preferredId?: string | null): Promise<ResolvedVoice>
}

export type TtsErrorKind = 'auth' | 'rate_limit' | 'server' | 'timeout' | 'bad_request' | 'network' | 'unknown'

export class TtsError extends Error {
  readonly kind: TtsErrorKind
  readonly status?: number
  readonly retryable: boolean
  /** Если сервер прислал Retry-After (напр. на 429) — предпочитать эту задержку экспоненциальной. */
  readonly retryAfterMs?: number

  constructor(message: string, kind: TtsErrorKind, status?: number, retryable = false, retryAfterMs?: number) {
    super(message)
    this.name = 'TtsError'
    this.kind = kind
    this.status = status
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}
