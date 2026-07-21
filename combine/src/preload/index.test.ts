import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CombineIpcApi } from '../shared/ipc'
import type { GenerationProgressEvent } from '../core/types/generation'
import { createDefaultSettings } from '../core/types/settings'

/**
 * Тесты стыковки моста (docs/DECISIONS.md D-22): полностью мокаем модуль 'electron' (contextBridge +
 * ipcRenderer) и проверяем, что preload/index.ts:
 *  1. экспонирует ОБА моста — вложенный `window.combine` (историческая форма) и плоский
 *     `window.combineApi` (CombineIpcApi из src/shared/ipc.ts, ожидаемый renderer'ом);
 *  2. каждая из 19 операций контракта (+ exportAnki, v1.1) на combineApi маппится на ПРАВИЛЬНЫЙ
 *     IPC-канал с ПРАВИЛЬНЫМ payload'ом — часть переиспользует уже существующие каналы combine:*
 *     (parseText/getSettings/saveSettings/pause/resume/cancel/onProgress), часть уходит на новые
 *     combine:api:* (см. src/main/ipc-handlers.ts#registerFlatApiHandlers).
 *
 * vi.hoisted — фабрика vi.mock() поднимается над импортами (см. тот же паттерн в
 * src/main/generation-session.test.ts), поэтому мутируемое состояние мока (invoke/on/removeListener
 * шпионы, exposed-карта "что зарегистрировано под каким именем") объявлено через vi.hoisted().
 */
const { invoke, on, removeListener, exposed } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposed: new Map<string, unknown>()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown): void => {
      exposed.set(key, api)
    }
  },
  ipcRenderer: { invoke, on, removeListener }
}))

function combineApi(): CombineIpcApi {
  const api = exposed.get('combineApi')
  if (!api) throw new Error('window.combineApi не был зарегистрирован preload-скриптом.')
  return api as CombineIpcApi
}

describe('preload/index.ts — window.combineApi поверх window.combine (D-22)', () => {
  beforeEach(async () => {
    vi.resetModules()
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
    exposed.clear()
    await import('./index')
  })

  it('регистрирует оба моста: вложенный combine и плоский combineApi', () => {
    expect(exposed.has('combine')).toBe(true)
    expect(exposed.has('combineApi')).toBe(true)
  })

  it('parseText -> существующий канал combine:parse-text', async () => {
    invoke.mockResolvedValueOnce({ lesson: null, errors: [], warnings: [], stats: {} })
    await combineApi().parseText('#TOPIC 1 | X')
    expect(invoke).toHaveBeenCalledWith('combine:parse-text', '#TOPIC 1 | X')
  })

  it('getSettings -> существующий канал combine:settings:get', async () => {
    invoke.mockResolvedValueOnce(createDefaultSettings('/tmp/lessons'))
    await combineApi().getSettings()
    expect(invoke).toHaveBeenCalledWith('combine:settings:get')
  })

  it('saveSettings -> существующий канал combine:settings:save', async () => {
    const settings = createDefaultSettings('/tmp/lessons')
    invoke.mockResolvedValueOnce(undefined)
    await combineApi().saveSettings(settings)
    expect(invoke).toHaveBeenCalledWith('combine:settings:save', settings)
  })

  // v1.2 (D-23): персистентность API-ключа — переиспользуют СУЩЕСТВУЮЩИЕ каналы вложенного
  // window.combine.settings.* (см. src/preload/index.ts) под именами плоского контракта.
  it('saveApiKey -> существующий канал combine:settings:set-api-key', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await combineApi().saveApiKey('sk-new-key')
    expect(invoke).toHaveBeenCalledWith('combine:settings:set-api-key', 'sk-new-key')
  })

  it('getApiKeyStatus -> комбинирует combine:settings:api-key-status + combine:settings:is-encryption-available, НИКОГДА не сам ключ', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'combine:settings:api-key-status') return Promise.resolve('ok')
      if (channel === 'combine:settings:is-encryption-available') return Promise.resolve(true)
      throw new Error(`неожиданный канал: ${channel}`)
    })
    const result = await combineApi().getApiKeyStatus()
    expect(result).toEqual({ status: 'ok', encryptionAvailable: true })
    expect(invoke).toHaveBeenCalledWith('combine:settings:api-key-status')
    expect(invoke).toHaveBeenCalledWith('combine:settings:is-encryption-available')
    // Форма результата — ТОЛЬКО статус/флаг, ключа в возвращаемом объекте в принципе не может быть.
    expect(Object.keys(result).sort()).toEqual(['encryptionAvailable', 'status'])
  })

  it('clearApiKey -> существующий канал combine:settings:clear-api-key', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await combineApi().clearApiKey()
    expect(invoke).toHaveBeenCalledWith('combine:settings:clear-api-key')
  })

  it('checkFfmpegAvailable -> новый канал combine:api:check-ffmpeg (v1.2, D-23)', async () => {
    invoke.mockResolvedValueOnce(true)
    const result = await combineApi().checkFfmpegAvailable()
    expect(invoke).toHaveBeenCalledWith('combine:api:check-ffmpeg')
    expect(result).toBe(true)
  })

  it('testConnection -> новый канал combine:api:test-connection с явным apiKey', async () => {
    const input = { provider: 'elevenlabs' as const, apiKey: 'sk-explicit' }
    invoke.mockResolvedValueOnce({ ok: true, message: 'ok', voiceCount: 5 })
    const result = await combineApi().testConnection(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:test-connection', input)
    expect(result.voiceCount).toBe(5)
  })

  it('listVoices -> новый канал combine:api:list-voices', async () => {
    const input = { provider: 'mock_say' as const, apiKey: null }
    invoke.mockResolvedValueOnce([])
    await combineApi().listVoices(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:list-voices', input)
  })

  it('estimateCost -> новый канал combine:api:estimate-cost', async () => {
    const input = { model: 'macos_say', pricePerThousandChars: { macos_say: 0 }, charactersEs: 10, charactersRu: 10 }
    invoke.mockResolvedValueOnce({ totalCharacters: 20, pricePerThousand: 0, estimatedCostUsd: 0, note: '' })
    await combineApi().estimateCost(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:estimate-cost', input)
  })

  it('startGeneration -> новый канал combine:api:start-generation (ParsedLesson + явный apiKey)', async () => {
    const input = {
      lesson: { topicId: '01-x', topicNumber: 1, titleRu: 'X', titleEs: null, languageVariants: null, blocks: [] },
      settings: createDefaultSettings('/tmp/lessons'),
      apiKey: null
    }
    invoke.mockResolvedValueOnce({ topicId: '01-x', lesson: {} })
    await combineApi().startGeneration(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:start-generation', input)
  })

  it('pauseGeneration/resumeGeneration/cancelGeneration -> существующие combine:generation:* (без аргументов)', async () => {
    invoke.mockResolvedValue(undefined)
    await combineApi().pauseGeneration({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:generation:pause')
    await combineApi().resumeGeneration({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:generation:resume')
    await combineApi().cancelGeneration({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:generation:cancel')
  })

  it('onGenerationProgress -> подписка на combine:generation:progress, payload распаковывается, unsubscribe снимает слушателя', () => {
    const callback = vi.fn()
    const unsubscribe = combineApi().onGenerationProgress(callback)
    expect(on).toHaveBeenCalledWith('combine:generation:progress', expect.any(Function))

    const listener = on.mock.calls[0][1] as (e: unknown, payload: GenerationProgressEvent) => void
    const payload: GenerationProgressEvent = {
      runState: 'running',
      totalItems: 1,
      doneItems: 0,
      failedItems: 0,
      pendingItems: 1,
      generatingItems: 0,
      currentItemId: null,
      currentText: null,
      elapsedMs: 0,
      speedPerMin: 0,
      etaSeconds: null,
      spentUsd: 0
    }
    listener({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)

    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith('combine:generation:progress', listener)
  })

  it('listLibrary -> новый канал combine:api:list-library (без аргументов)', async () => {
    invoke.mockResolvedValueOnce([])
    await combineApi().listLibrary()
    expect(invoke).toHaveBeenCalledWith('combine:api:list-library')
  })

  it('exportZip -> новый канал combine:api:export-zip', async () => {
    invoke.mockResolvedValueOnce({ zipPath: '/x/lesson.zip' })
    await combineApi().exportZip({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:api:export-zip', { topicId: 't' })
  })

  it('regenerateAll -> новый канал combine:api:regenerate-all', async () => {
    invoke.mockResolvedValueOnce({ topicId: 't', lesson: {} })
    await combineApi().regenerateAll({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:api:regenerate-all', { topicId: 't' })
  })

  it('regenerateFailed -> новый канал combine:api:regenerate-failed', async () => {
    invoke.mockResolvedValueOnce({ topicId: 't', lesson: {} })
    await combineApi().regenerateFailed({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:api:regenerate-failed', { topicId: 't' })
  })

  it('deleteLesson -> новый канал combine:api:delete-lesson', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await combineApi().deleteLesson({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:api:delete-lesson', { topicId: 't' })
  })

  it('openLessonFolder -> новый канал combine:api:open-lesson-folder', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await combineApi().openLessonFolder({ topicId: 't' })
    expect(invoke).toHaveBeenCalledWith('combine:api:open-lesson-folder', { topicId: 't' })
  })

  it('testSnippet -> новый канал combine:api:test-snippet (явный apiKey)', async () => {
    const input = {
      text: 'Hola, ¿cómo estás?',
      lang: 'es' as const,
      voiceId: 'v-es',
      voiceName: 'Mónica',
      provider: 'elevenlabs' as const,
      model: 'eleven_flash_v2_5',
      apiKey: 'sk-explicit'
    }
    invoke.mockResolvedValueOnce({ audioDataUrl: 'data:audio/mpeg;base64,AAA', durationMs: 900, characters: 19, costUsd: 0.001 })
    await combineApi().testSnippet(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:test-snippet', input)
  })

  it('getPhraseAudio -> новый канал combine:api:get-phrase-audio', async () => {
    const input = { topicId: '04-hablar-de-mi-mismo', phraseId: '04-b1-llamarse-01', lang: 'es' as const }
    invoke.mockResolvedValueOnce({ audioDataUrl: 'data:audio/mpeg;base64,AAA', durationMs: 900 })
    await combineApi().getPhraseAudio(input)
    expect(invoke).toHaveBeenCalledWith('combine:api:get-phrase-audio', input)
  })

  it('exportAnki -> новый канал combine:api:export-anki (v1.1)', async () => {
    invoke.mockResolvedValueOnce({ apkgPath: '/x/lesson.apkg', noteCount: 13, mediaCount: 26 })
    const result = await combineApi().exportAnki({ topicId: '04-hablar-de-mi-mismo' })
    expect(invoke).toHaveBeenCalledWith('combine:api:export-anki', { topicId: '04-hablar-de-mi-mismo' })
    expect(result.mediaCount).toBe(26)
  })
})
