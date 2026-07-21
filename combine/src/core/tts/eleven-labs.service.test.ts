import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ElevenLabsService } from './eleven-labs.service'

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
})
