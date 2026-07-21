import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ElevenLabsService } from './eleven-labs.service'
import type { LoudnessNormalizer } from '../util/ffmpeg'

// Валидный минимальный MP3-фрейм-заголовок (sync 0xFFFB) — этого достаточно, т.к. в тестах нас
// интересует HTTP-контракт, а не декодирование музыки; ElevenLabsService лишь оборачивает байты в Buffer.
const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6])

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

function startServer(handler: Handler): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.on('error', () => undefined)
      Promise.resolve(handler(req, res)).catch(() => {
        if (!res.writableEnded) res.destroy()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
    })
    req.on('end', () => resolve(data))
  })
}

describe('ElevenLabsService — против локального HTTP-стаба (node:http, без реальной сети)', () => {
  let activeServer: Server | null = null

  afterEach(async () => {
    if (activeServer) {
      activeServer.closeAllConnections?.()
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()))
      activeServer = null
    }
  })

  it('успех: заголовок xi-api-key, корректное тело запроса, ответ audio/mpeg', async () => {
    let receivedHeaders: IncomingMessage['headers'] | null = null
    let receivedBody = ''
    let receivedUrl = ''
    const { server, baseUrl } = await startServer(async (req, res) => {
      receivedHeaders = req.headers
      receivedUrl = req.url ?? ''
      receivedBody = await readBody(req)
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(FAKE_MP3)
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'test-key-123', baseUrl })
    const result = await service.synthesize({
      text: 'Hola',
      lang: 'es',
      voiceId: 'voice-abc',
      modelId: 'eleven_multilingual_v2',
      stability: 0.5,
      similarityBoost: 0.75,
      seed: 42
    })

    expect(receivedHeaders?.['xi-api-key']).toBe('test-key-123')
    expect(receivedUrl).toContain('/v1/text-to-speech/voice-abc')
    expect(JSON.parse(receivedBody)).toEqual({
      text: 'Hola',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      seed: 42
    })
    expect(result.audio.equals(FAKE_MP3)).toBe(true)
    expect(result.characters).toBe(4)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('401 — не ретраит (auth, не должен повторять запрос)', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: { message: 'invalid_api_key' } }))
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'bad-key', baseUrl, maxRetries: 3, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'eleven_multilingual_v2' })
    ).rejects.toMatchObject({ kind: 'auth', retryable: false })
    expect(calls).toBe(1)
  })

  it('400 — не ретраит (bad_request)', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'bad request' }))
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 3, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    ).rejects.toMatchObject({ kind: 'bad_request', retryable: false })
    expect(calls).toBe(1)
  })

  it('429 → exponential backoff → в итоге успех', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      if (calls < 3) {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ detail: 'rate limited' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(FAKE_MP3)
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 3, backoffBaseMs: 5 })
    const result = await service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    expect(calls).toBe(3) // 2 неудачи (429) + финальный успех
    expect(result.audio.equals(FAKE_MP3)).toBe(true)
  })

  it('5xx → backoff → ошибка после исчерпания retries (kind=server)', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'service unavailable' }))
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 2, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    ).rejects.toMatchObject({ kind: 'server', retryable: true })
    expect(calls).toBe(3) // изначальная попытка + 2 ретрая
  })

  it('timeout → TtsError(kind=timeout), запрос обрывается по AbortController', async () => {
    const { server, baseUrl } = await startServer(() => {
      // намеренно никогда не отвечаем — эмуляция зависшего запроса
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 0, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm', timeoutMs: 80 })
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('РЕГРЕССИЯ: таймаут покрывает и чтение тела, не только заголовки (abort посреди стриминга MP3)', async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      // Отвечаем заголовками сразу (200 audio/mpeg) и шлём только ЧАСТЬ тела, никогда не завершая —
      // res.arrayBuffer() на клиенте зависнет в ожидании конца потока, если таймаут его не накроет.
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.write(Buffer.from([0xff, 0xfb]))
      // намеренно не вызываем res.end()
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 0, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm', timeoutMs: 80 })
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  /**
   * Мульти-верификаторное ревью (minor, eleven-labs.service.ts:125): 200 OK на платном
   * text-to-speech эндпоинте означает, что ElevenLabs УЖЕ сгенерировал (и списал деньги за) речь —
   * abort при чтении ТЕЛА после этого момента не должен молча ретраиться withRetry() ЕЩЁ РАЗ (это
   * означало бы повторный платный синтез просто чтобы обойти локальный сбой скачивания байтов).
   * До фикса: retryable:true здесь -> при maxRetries>0 сервер получил бы ВТОРОЙ POST-запрос.
   */
  it('РЕГРЕССИЯ: abort при чтении тела ПОСЛЕ 200 OK на платном synthesize — retryable:false, НЕ ретраится (не удваивает счёт)', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.write(Buffer.from([0xff, 0xfb]))
      // намеренно не вызываем res.end() — тело никогда не завершится, abort сработает по таймауту.
    })
    activeServer = server

    // maxRetries:2 — если бы retryable оставался true, withRetry() сделал бы ЕЩЁ 2 POST-запроса.
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 2, backoffBaseMs: 5 })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm', timeoutMs: 80 })
    ).rejects.toMatchObject({ kind: 'timeout', retryable: false })
    expect(calls).toBe(1) // ровно один платный запрос — сбой чтения тела не вызвал повторную оплаченную генерацию
  })

  /**
   * Контраст с тестом выше: listVoices()/listModels() вызывают fetchAndRead() НАПРЯМУЮ, а не через
   * withRetry() (retry есть только у synthesize(), см. строку с `return this.withRetry(...)` в
   * synthesize()) — так что bodyReadTimeoutRetryable у них остаётся дефолтным (true) и в любом
   * случае не приводит к фактическому повтору запроса самой ElevenLabsService (нечему её
   * ретраить). Проверяем только, что точечный фикс (options?.bodyReadTimeoutRetryable) не задел
   * значение retryable в ошибке, возвращаемой listVoices() — на случай, если ВЫЗЫВАЮЩИЙ КОД
   * когда-нибудь сам решит ретраить список голосов на основании этого поля.
   */
  it('listVoices() — abort при чтении тела ПОСЛЕ 200 OK по-прежнему помечен retryable:true (точечный фикс не задевает бесплатный эндпоинт)', async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"voices":[') // незавершённый JSON, res.end() намеренно не вызывается
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, listTimeoutMs: 80 })
    await expect(service.listVoices()).rejects.toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('РЕГРЕССИЯ: listVoices()/listModels() тоже обрываются по таймауту (раньше — без AbortController, висли вечно)', async () => {
    const { server, baseUrl } = await startServer(() => {
      // никогда не отвечаем
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, listTimeoutMs: 80 })
    await expect(service.listVoices()).rejects.toMatchObject({ kind: 'timeout' })
    await expect(service.listModels()).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('РЕГРЕССИЯ: 429 с заголовком Retry-After использует его вместо экспоненциального backoff', async () => {
    let calls = 0
    const { server, baseUrl } = await startServer((_req, res) => {
      calls += 1
      if (calls === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0.05' })
        res.end(JSON.stringify({ detail: 'rate limited' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(FAKE_MP3)
    })
    activeServer = server

    // backoffBaseMs огромный (2000мс) — если бы Retry-After игнорировался, тест занял бы >=2с.
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 1, backoffBaseMs: 2000 })
    const started = Date.now()
    const result = await service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    const elapsedMs = Date.now() - started
    expect(result.audio.equals(FAKE_MP3)).toBe(true)
    expect(calls).toBe(2)
    expect(elapsedMs).toBeLessThan(1000) // намного меньше 2000мс экспоненты — использован Retry-After
  })

  it('РЕГРЕССИЯ: настоящий сетевой сбой (fetchImpl бросает) — ретраится как retryable network-ошибка', async () => {
    let calls = 0
    const flakyFetch: typeof fetch = async (...args) => {
      calls += 1
      if (calls < 2) throw new TypeError('fetch failed: ECONNREFUSED')
      return fetch(...args)
    }
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(FAKE_MP3)
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, maxRetries: 2, backoffBaseMs: 5, fetchImpl: flakyFetch })
    const result = await service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    expect(calls).toBe(2)
    expect(result.audio.equals(FAKE_MP3)).toBe(true)
  })

  it('listVoices() парсит { voices: [...] } с preview_url', async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          voices: [
            { voice_id: 'v1', name: 'Pablo', preview_url: 'https://cdn.example.com/p1.mp3', category: 'premade' }
          ]
        })
      )
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl })
    const voices = await service.listVoices()
    expect(voices).toEqual([
      { id: 'v1', name: 'Pablo', previewUrl: 'https://cdn.example.com/p1.mp3', category: 'premade', labels: undefined }
    ])
  })

  it('listModels() парсит плоский массив с model_id/name', async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify([
          { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
          { model_id: 'eleven_flash_v2_5', name: 'Flash v2.5' }
        ])
      )
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl })
    const models = await service.listModels()
    expect(models).toEqual([
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
      { id: 'eleven_flash_v2_5', name: 'Flash v2.5' }
    ])
  })

  it('listVoices() пробрасывает auth-ошибку при 401', async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: 'invalid key' }))
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'bad', baseUrl })
    await expect(service.listVoices()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('РЕГРЕССИЯ: ошибка разбора ТЕЛА после успешного 200 (не сеть, не abort) — kind=unknown, retryable=false, не путается с сетевой', async () => {
    // Сервер отвечает 200, но с невалидным JSON — res.json() бросит SyntaxError уже ПОСЛЕ res.ok.
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('это не json {{{')
    })
    activeServer = server

    const service = new ElevenLabsService({ apiKey: 'k', baseUrl })
    await expect(service.listVoices()).rejects.toMatchObject({ kind: 'unknown', retryable: false })
  })

  it('РЕГРЕССИЯ: программная ошибка чтения тела при synthesize() НЕ ретраится (kind=unknown, retryable=false, 1 вызов)', async () => {
    // fetchImpl инжектирован напрямую (без реального сервера) — эмулирует ответ с ok:true, но
    // с багом в чтении тела (напр. arrayBuffer() бросил TypeError не по сетевой причине).
    let calls = 0
    const brokenFetch = (async () => {
      calls += 1
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => '',
        arrayBuffer: async () => {
          throw new TypeError('баг: неожиданный сбой при чтении тела, не связанный с сетью')
        }
      } as unknown as Response
    }) as typeof fetch

    const service = new ElevenLabsService({
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:1',
      maxRetries: 3,
      backoffBaseMs: 5,
      fetchImpl: brokenFetch
    })
    await expect(
      service.synthesize({ text: 'x', lang: 'es', voiceId: 'v', modelId: 'm' })
    ).rejects.toMatchObject({ kind: 'unknown', retryable: false })
    // Будь это (неверно) классифицировано как retryable network — вызовов было бы 4 (1 + maxRetries).
    expect(calls).toBe(1)
  })
})

/**
 * v1.2 (D-23) — нормализация громкости через инжектируемый LoudnessNormalizer (не реальный ffmpeg,
 * см. core/util/ffmpeg.test.ts для того немногого, что можно проверить БЕЗ реального бинарника —
 * ffmpeg не установлен даже на машине разработки этой фичи, см. коммит). Тот же паттерн инъекции,
 * что и fetchImpl выше — тесты никогда не зависят от того, есть ли ffmpeg на машине с тестами/CI.
 */
describe('ElevenLabsService — нормализация громкости (v1.2, D-23, инжектируемый normalizer)', () => {
  let activeServer: Server | null = null

  afterEach(async () => {
    if (activeServer) {
      activeServer.closeAllConnections?.()
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()))
      activeServer = null
    }
  })

  async function serveFakeMp3(): Promise<string> {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      res.end(FAKE_MP3)
    })
    activeServer = server
    return baseUrl
  }

  function fakeNormalizer(overrides: Partial<LoudnessNormalizer> = {}): LoudnessNormalizer {
    return {
      isAvailable: vi.fn(async () => true),
      normalize: vi.fn(async (mp3: Buffer) => Buffer.concat([mp3, Buffer.from('NORMALIZED')])),
      ...overrides
    }
  }

  it('ffmpeg доступен -> normalizer.normalize() вызван, audio заменяется, normalizationNote — успех', async () => {
    const baseUrl = await serveFakeMp3()
    const normalizer = fakeNormalizer()
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, normalizer })

    const result = await service.synthesize({ text: 'Hola', lang: 'es', voiceId: 'v', modelId: 'm' })

    expect(normalizer.isAvailable).toHaveBeenCalledTimes(1)
    expect(normalizer.normalize).toHaveBeenCalledTimes(1)
    expect(normalizer.normalize).toHaveBeenCalledWith(expect.objectContaining({ length: FAKE_MP3.length }))
    expect(result.audio.equals(Buffer.concat([FAKE_MP3, Buffer.from('NORMALIZED')]))).toBe(true)
    expect(result.normalizationNote).toMatch(/нормализована/i)
  })

  it('ffmpeg НЕДОСТУПЕН -> normalize() не вызывается, audio исходный, normalizationNote — предупреждение', async () => {
    const baseUrl = await serveFakeMp3()
    const normalizer = fakeNormalizer({ isAvailable: vi.fn(async () => false) })
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, normalizer })

    const result = await service.synthesize({ text: 'Hola', lang: 'es', voiceId: 'v', modelId: 'm' })

    expect(normalizer.isAvailable).toHaveBeenCalledTimes(1)
    expect(normalizer.normalize).not.toHaveBeenCalled()
    expect(result.audio.equals(FAKE_MP3)).toBe(true) // исходные байты, без изменений
    expect(result.normalizationNote).toMatch(/недоступна.*ffmpeg/i)
  })

  it('normalize: false (настройка выключена) -> normalizer вообще не опрашивается', async () => {
    const baseUrl = await serveFakeMp3()
    const normalizer = fakeNormalizer()
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, normalize: false, normalizer })

    const result = await service.synthesize({ text: 'Hola', lang: 'es', voiceId: 'v', modelId: 'm' })

    expect(normalizer.isAvailable).not.toHaveBeenCalled()
    expect(normalizer.normalize).not.toHaveBeenCalled()
    expect(result.audio.equals(FAKE_MP3)).toBe(true)
    expect(result.normalizationNote).toBeNull()
  })

  it('normalizer.normalize() бросает -> best-effort: остаётся исходное audio, ошибка не проваливает фразу', async () => {
    const baseUrl = await serveFakeMp3()
    const normalizer = fakeNormalizer({
      normalize: vi.fn(async () => {
        throw new Error('ffmpeg завершился с кодом 1')
      })
    })
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, normalizer })

    const result = await service.synthesize({ text: 'Hola', lang: 'es', voiceId: 'v', modelId: 'm' })

    expect(result.audio.equals(FAKE_MP3)).toBe(true) // откат к исходному, а не throw наружу
    expect(result.normalizationNote).toMatch(/не удалась/i)
  })

  it('по умолчанию (normalize не указан) — нормализация включена', async () => {
    const baseUrl = await serveFakeMp3()
    const normalizer = fakeNormalizer()
    const service = new ElevenLabsService({ apiKey: 'k', baseUrl, normalizer })

    await service.synthesize({ text: 'Hola', lang: 'es', voiceId: 'v', modelId: 'm' })

    expect(normalizer.isAvailable).toHaveBeenCalledTimes(1)
  })
})
