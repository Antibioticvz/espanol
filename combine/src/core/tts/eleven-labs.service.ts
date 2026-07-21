import type { TTSProvider, TtsModel, TtsSynthesizeParams, TtsSynthesizeResult, TtsVoice } from './tts-provider'
import { TtsError } from './tts-provider'

/**
 * ElevenLabsService — реальный контракт API ElevenLabs (см. docs.elevenlabs.io и docs/DECISIONS.md D-01/D-02/D-03,
 * НЕ docs/DEPLOYMENT.md, где заголовок авторизации указан неверно):
 *  - Заголовок авторизации: `xi-api-key: <ключ>` (НЕ Bearer).
 *  - `GET /v1/voices` → { voices: [{ voice_id, name, preview_url, category, labels, ... }] }.
 *  - `GET /v1/models` → плоский JSON-массив [{ model_id, name, ... }].
 *  - `POST /v1/text-to-speech/{voice_id}` → тело { text, model_id, voice_settings:{stability,similarity_boost}, seed? },
 *    ответ — сырые байты audio/mpeg (не JSON).
 *  - Retry: exponential backoff 1s/2s/4s только для 429/5xx/timeout; 401/400 не ретраятся;
 *    429 уважает заголовок Retry-After сервера, если он есть (иначе — экспонента).
 *
 * baseUrl инжектируется конструктором — тесты поднимают локальный http-стаб (node:http на 127.0.0.1)
 * и НИКОГДА не обращаются к реальному api.elevenlabs.io (правило №1 CLAUDE.md — реальный запрос платный).
 */

export interface ElevenLabsServiceOptions {
  apiKey: string
  /** По умолчанию https://api.elevenlabs.io — переопределяется в тестах локальным стабом. */
  baseUrl?: string
  /** Максимум ретраев на 429/5xx/timeout. По умолчанию 3. */
  maxRetries?: number
  /** База экспоненциального backoff в мс (1x/2x/4x...). По умолчанию 1000 (1s/2s/4s). Тесты уменьшают. */
  backoffBaseMs?: number
  /** Таймаут для GET /v1/voices и GET /v1/models (не связан с per-request timeoutMs синтеза). */
  listTimeoutMs?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io'
const DEFAULT_LIST_TIMEOUT_MS = 15000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Разбирает Retry-After: либо число секунд, либо HTTP-дата. undefined, если не удалось. */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined
  const seconds = Number(headerValue)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(headerValue)
  if (!Number.isNaN(dateMs)) {
    const deltaMs = dateMs - Date.now()
    return deltaMs > 0 ? deltaMs : 0
  }
  return undefined
}

export class ElevenLabsService implements TTSProvider {
  readonly id = 'elevenlabs' as const

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly backoffBaseMs: number
  private readonly listTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ElevenLabsServiceOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.maxRetries = options.maxRetries ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 1000
    this.listTimeoutMs = options.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { 'xi-api-key': this.apiKey, ...extra }
  }

  /**
   * fetch() + чтение тела под ОДНИМ AbortController/таймером — таймаут обязан покрывать не
   * только заголовки ответа, но и стриминг тела (напр. abort может сработать посреди
   * res.arrayBuffer() у большого MP3; без этого AbortError утёк бы наружу необёрнутым вместо
   * TtsError(kind:'timeout')). Также используется для listVoices/listModels (ранее без таймаута
   * вообще — зависшая сеть вешала промис навсегда).
   */
  private async fetchAndRead<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    readBody: (res: Response) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal })
      if (!res.ok) throw await this.toError(res)
      return await readBody(res)
    } catch (e) {
      if (e instanceof TtsError) throw e
      if (e instanceof Error && e.name === 'AbortError') {
        throw new TtsError(`Таймаут запроса (${timeoutMs} мс)`, 'timeout', undefined, true)
      }
      throw new TtsError(`Сетевая ошибка запроса: ${e instanceof Error ? e.message : String(e)}`, 'network', undefined, true)
    } finally {
      clearTimeout(timer)
    }
  }

  async listVoices(): Promise<TtsVoice[]> {
    const data = await this.fetchAndRead<{ voices?: Array<Record<string, unknown>> }>(
      `${this.baseUrl}/v1/voices`,
      { headers: this.headers() },
      this.listTimeoutMs,
      (res) => res.json() as Promise<{ voices?: Array<Record<string, unknown>> }>
    )
    const voices = Array.isArray(data.voices) ? data.voices : []
    return voices.map((v) => ({
      id: String(v.voice_id ?? ''),
      name: String(v.name ?? v.voice_id ?? ''),
      previewUrl: typeof v.preview_url === 'string' ? v.preview_url : null,
      category: typeof v.category === 'string' ? v.category : null,
      labels: v.labels && typeof v.labels === 'object' ? (v.labels as Record<string, string>) : undefined
    }))
  }

  async listModels(): Promise<TtsModel[]> {
    const data = await this.fetchAndRead<unknown>(
      `${this.baseUrl}/v1/models`,
      { headers: this.headers() },
      this.listTimeoutMs,
      (res) => res.json()
    )
    const arr = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
    return arr.map((m) => ({ id: String(m.model_id ?? ''), name: String(m.name ?? m.model_id ?? '') }))
  }

  async synthesize(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult> {
    return this.withRetry(() => this.synthesizeOnce(params))
  }

  private async synthesizeOnce(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult> {
    const timeoutMs = params.timeoutMs ?? 30000
    const body: Record<string, unknown> = {
      text: params.text,
      model_id: params.modelId,
      voice_settings: {
        stability: params.stability ?? 0.5,
        similarity_boost: params.similarityBoost ?? 0.75
      }
    }
    if (params.seed !== null && params.seed !== undefined) body.seed = params.seed

    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(params.voiceId)}?output_format=mp3_44100_128`
    const arrayBuffer = await this.fetchAndRead(
      url,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json', Accept: 'audio/mpeg' }),
        body: JSON.stringify(body)
      },
      timeoutMs,
      (res) => res.arrayBuffer()
    )
    const audio = Buffer.from(arrayBuffer)
    const durationMs = await this.estimateDurationMs(audio)
    return { audio, durationMs, characters: params.text.length }
  }

  /** D-13: длительность реальной генерации — из самого MP3 (music-metadata), а не по числу слов. */
  private async estimateDurationMs(audio: Buffer): Promise<number> {
    try {
      // music-metadata — ESM-only; main процесс собирается в CJS, поэтому статический import
      // превратился бы в require() и упал с ERR_REQUIRE_ESM. Динамический import() работает всегда.
      const mm = await import('music-metadata')
      const meta = await mm.parseBuffer(audio, { mimeType: 'audio/mpeg' })
      return Math.round((meta.format.duration ?? 0) * 1000)
    } catch (e) {
      // НЕ тихий успех: если длительность не удалось определить, phrase получит duration_ms=0,
      // что заметно на экране генерации/библиотеки — залогируем причину, а не проглатываем молча.
      console.warn(
        `[ElevenLabsService] Не удалось определить длительность MP3 через music-metadata (duration_ms будет 0): ${
          e instanceof Error ? e.message : String(e)
        }`
      )
      return 0
    }
  }

  private async toError(res: Response): Promise<TtsError> {
    let bodyText = ''
    try {
      bodyText = await res.text()
    } catch {
      /* игнорируем — используем statusText */
    }
    const status = res.status
    const detail = bodyText || res.statusText
    if (status === 401 || status === 403) {
      return new TtsError(`Ошибка авторизации ElevenLabs (${status}): ${detail}`, 'auth', status, false)
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'))
      return new TtsError(`Превышен лимит запросов ElevenLabs (429): ${detail}`, 'rate_limit', status, true, retryAfterMs)
    }
    if (status === 400 || status === 422) {
      return new TtsError(`Некорректный запрос к ElevenLabs (${status}): ${detail}`, 'bad_request', status, false)
    }
    if (status >= 500) {
      return new TtsError(`Ошибка сервера ElevenLabs (${status}): ${detail}`, 'server', status, true)
    }
    return new TtsError(`Неожиданный ответ ElevenLabs (${status}): ${detail}`, 'unknown', status, false)
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (e) {
        lastError = e
        // Неизвестные (не-TtsError) ошибки — НЕ ретраим: это, скорее всего, программная ошибка
        // (баг), а не временный сбой сети/сервера, и слепой ретрай лишь маскирует её на 1s/2s/4s.
        const retryable = e instanceof TtsError ? e.retryable : false
        if (!retryable || attempt === this.maxRetries) throw e
        const delay =
          e instanceof TtsError && e.retryAfterMs !== undefined ? e.retryAfterMs : this.backoffBaseMs * Math.pow(2, attempt)
        await sleep(delay)
      }
    }
    throw lastError
  }
}
