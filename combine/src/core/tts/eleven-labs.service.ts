import type { TTSProvider, TtsModel, TtsSynthesizeParams, TtsSynthesizeResult, TtsVoice } from './tts-provider'
import { TtsError } from './tts-provider'
import { FfmpegLoudnessNormalizer, type LoudnessNormalizer } from '../util/ffmpeg'

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
  /** v1.2 (D-23): нормализация громкости (AppSettings.normalizeAudio). По умолчанию true. */
  normalize?: boolean
  /** Переопределяемо в тестах — по умолчанию реальный ffmpeg (см. core/util/ffmpeg.ts). */
  normalizer?: LoudnessNormalizer
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
  private readonly normalize: boolean
  private readonly normalizer: LoudnessNormalizer

  constructor(options: ElevenLabsServiceOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.maxRetries = options.maxRetries ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 1000
    this.listTimeoutMs = options.listTimeoutMs ?? DEFAULT_LIST_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
    this.normalize = options.normalize ?? true
    this.normalizer = options.normalizer ?? new FfmpegLoudnessNormalizer()
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
  /**
   * ВАЖНО (issue #12 второго ревью): fetch() самого запроса и чтение тела ответа классифицируются
   * ОТДЕЛЬНО. Раньше единый try/catch заворачивал ЛЮБУЮ ошибку (включая программные — битый JSON,
   * баг в readBody) в TtsError(kind:'network', retryable:true) — это обесценивало правило "не-TtsError
   * не ретраить" из withRetry(): непредвиденная ошибка парсинга тихо ретраилась 1s/2s/4s наравне
   * с реальным сбоем сети, маскируя баг под "временную проблему". Теперь: сбой САМОГО fetch()
   * (до получения ответа) — сеть/таймаут, retryable:true, как и раньше; сбой ЧТЕНИЯ ТЕЛА
   * ПОСЛЕ успешного res.ok — если это abort (таймаут мог сработать и во время стриминга тела),
   * тоже 'timeout'; любая ДРУГАЯ ошибка на этом этапе — 'unknown', retryable:false.
   *
   * Мульти-верификаторное ревью (minor, eleven-labs.service.ts:125): abort/таймаут ПОСЛЕ res.ok
   * (т.е. заголовки уже пришли, ElevenLabs уже вернул 200 и НАЧАЛ отдавать байты) отличается от
   * abort ДО ответа принципиально по деньгам — на платном эндпоинте синтеза
   * (POST /v1/text-to-speech, см. synthesizeOnce) 200 OK означает, что генерация речи уже
   * произошла и УЖЕ ОПЛАЧЕНА; withRetry() автоматически повторяющий запрос из-за retryable:true
   * заново запросил бы у ElevenLabs ЕЩЁ ОДИН платный синтез только чтобы обойти локальный сбой
   * скачивания байтов — незаметное для пользователя удвоение (и далее кратное увеличение) счёта
   * за один и тот же таймаут. bodyReadTimeoutRetryable позволяет вызывающему коду (synthesizeOnce)
   * пометить этот путь retryable:false — фраза уйдёт в 'failed' и потребует явного повторного
   * запуска генерации человеком, а не тихого автоматического пере-биллинга. listVoices/listModels
   * — бесплатные метаданные, для них abort-посреди-тела по-прежнему retryable:true (по умолчанию).
   */
  private async fetchAndRead<T>(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    readBody: (res: Response) => Promise<T>,
    options?: { bodyReadTimeoutRetryable?: boolean }
  ): Promise<T> {
    const bodyReadTimeoutRetryable = options?.bodyReadTimeoutRetryable ?? true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let res: Response
      try {
        res = await this.fetchImpl(url, { ...init, signal: controller.signal })
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new TtsError(`Таймаут запроса (${timeoutMs} мс)`, 'timeout', undefined, true)
        }
        throw new TtsError(`Сетевая ошибка запроса: ${e instanceof Error ? e.message : String(e)}`, 'network', undefined, true)
      }
      if (!res.ok) throw await this.toError(res)
      try {
        return await readBody(res)
      } catch (e) {
        if (e instanceof TtsError) throw e
        if (e instanceof Error && e.name === 'AbortError') {
          throw new TtsError(
            `Таймаут чтения ответа (${timeoutMs} мс) после успешного ответа сервера (200 OK)`,
            'timeout',
            undefined,
            bodyReadTimeoutRetryable
          )
        }
        throw new TtsError(
          `Не удалось разобрать ответ ElevenLabs: ${e instanceof Error ? e.message : String(e)}`,
          'unknown',
          undefined,
          false
        )
      }
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
      (res) => res.arrayBuffer(),
      // Платный эндпоинт — 200 OK уже означает состоявшуюся (оплаченную) генерацию, см. docstring
      // fetchAndRead() выше. Таймаут чтения ТЕЛА после этого НЕ должен молча вызывать повторную
      // (снова платную) попытку синтеза.
      { bodyReadTimeoutRetryable: false }
    )
    const rawAudio = Buffer.from(arrayBuffer)
    const { audio, normalizationNote } = await this.applyNormalization(rawAudio)
    const durationMs = await this.estimateDurationMs(audio)
    return { audio, durationMs, characters: params.text.length, normalizationNote }
  }

  /**
   * v1.2 (D-23): ElevenLabs отдаёт готовый MP3 (не PCM) — единственный практичный способ
   * нормализовать громкость уже закодированного файла без чистого JS MP3-декодера — внешний
   * ffmpeg (this.normalizer, по умолчанию FfmpegLoudnessNormalizer). Best-effort: недоступность
   * ffmpeg или сбой самой нормализации НЕ проваливают фразу — просто сохраняется исходный уровень
   * громкости, а причина попадает в normalizationNote (см. GenerationQueue → лог).
   */
  private async applyNormalization(rawAudio: Buffer): Promise<{ audio: Buffer; normalizationNote: string | null }> {
    if (!this.normalize) return { audio: rawAudio, normalizationNote: null }
    const available = await this.normalizer.isAvailable()
    if (!available) {
      return {
        audio: rawAudio,
        normalizationNote:
          '⚠ Нормализация громкости недоступна: ffmpeg не найден в PATH — фраза сохранена без нормализации (установите ffmpeg, напр. `brew install ffmpeg`).'
      }
    }
    try {
      const normalized = await this.normalizer.normalize(rawAudio)
      return { audio: normalized, normalizationNote: 'Громкость нормализована (ffmpeg loudnorm, EBU R128 I=-18 LUFS).' }
    } catch (e) {
      return {
        audio: rawAudio,
        normalizationNote: `⚠ Нормализация громкости не удалась (${e instanceof Error ? e.message : String(e)}) — сохранён исходный уровень.`
      }
    }
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
