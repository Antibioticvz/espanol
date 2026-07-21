import { contextBridge, ipcRenderer } from 'electron'
import type { ParseResult } from '../core/types/parsed-lesson'
import type { AppSettings } from '../core/types/settings'
import type { GenerationProgressEvent, QueueConfig } from '../core/types/generation'
import type { Provider } from '../core/types/lesson-json'
import type { TtsModel, TtsVoice } from '../core/tts/tts-provider'
import type { LessonSummary } from '../core/file/file.service'
import type { TestGenerationParams, TestGenerationResult } from '../main/test-generation'
import type { ApiKeyStatus } from '../core/settings/settings.service'
import type {
  ApiKeyStatusResult,
  CombineIpcApi,
  EstimateCostInput,
  EstimateCostResult,
  ExportAnkiInput,
  ExportAnkiResult,
  ExportZipResult,
  GenerationRunRef,
  GetPhraseAudioInput,
  GetPhraseAudioResult,
  LibraryEntry,
  ListVoicesInput,
  ParseTextResult,
  StartGenerationInput,
  StartGenerationResult,
  TestConnectionInput,
  TestConnectionResult,
  TestSnippetInput,
  TestSnippetResult,
  UnsubscribeFn,
  VoiceOption
} from '../shared/ipc'

/**
 * Единственная поверхность, которую renderer видит как `window.combine` (contextIsolation: true,
 * nodeIntegration: false — renderer не имеет прямого доступа к Node/Electron API). Имена методов
 * здесь соответствуют каналам, зарегистрированным в src/main/ipc-handlers.ts; финальную стыковку
 * с реализацией renderer (ветка feat/combine-ui) делает оркестратор при merge.
 */
const api = {
  parseText: (text: string): Promise<ParseResult> => ipcRenderer.invoke('combine:parse-text', text),

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('combine:settings:get'),
    save: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('combine:settings:save', settings),
    hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('combine:settings:has-api-key'),
    /** issue #10: детальнее hasApiKey() — позволяет UI показать "ключ повреждён, введите заново". */
    apiKeyStatus: (): Promise<ApiKeyStatus> => ipcRenderer.invoke('combine:settings:api-key-status'),
    isEncryptionAvailable: (): Promise<boolean> => ipcRenderer.invoke('combine:settings:is-encryption-available'),
    setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('combine:settings:set-api-key', apiKey),
    clearApiKey: (): Promise<void> => ipcRenderer.invoke('combine:settings:clear-api-key'),
    testConnection: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('combine:settings:test-connection')
  },

  voices: {
    list: (provider: Provider): Promise<TtsVoice[]> => ipcRenderer.invoke('combine:voices:list', provider),
    models: (provider: Provider): Promise<TtsModel[]> => ipcRenderer.invoke('combine:models:list', provider)
  },

  /** D-05: «Тестовая генерация» — один TTS-запрос вне очереди. */
  testGenerate: (params: TestGenerationParams): Promise<TestGenerationResult> => ipcRenderer.invoke('combine:test-generate', params),

  generation: {
    start: (params: { inputText: string; settings: AppSettings }): Promise<{ topicId: string }> =>
      ipcRenderer.invoke('combine:generation:start', params),
    regenerate: (params: {
      topicId: string
      outputRoot: string
      mode: 'all' | 'failed'
      queueConfig: QueueConfig
      pricePerThousandChars: Record<string, number>
    }): Promise<void> => ipcRenderer.invoke('combine:generation:regenerate', params),
    pause: (): Promise<void> => ipcRenderer.invoke('combine:generation:pause'),
    resume: (): Promise<void> => ipcRenderer.invoke('combine:generation:resume'),
    cancel: (): Promise<void> => ipcRenderer.invoke('combine:generation:cancel'),
    isActive: (): Promise<boolean> => ipcRenderer.invoke('combine:generation:is-active'),
    /** Возвращает функцию отписки. */
    onProgress: (callback: (event: GenerationProgressEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: GenerationProgressEvent): void => callback(payload)
      ipcRenderer.on('combine:generation:progress', listener)
      return () => ipcRenderer.removeListener('combine:generation:progress', listener)
    }
  },

  library: {
    list: (outputRoot: string): Promise<LessonSummary[]> => ipcRenderer.invoke('combine:library:list', outputRoot),
    delete: (params: { outputRoot: string; topicId: string }): Promise<void> => ipcRenderer.invoke('combine:library:delete', params),
    exportZip: (params: { outputRoot: string; topicId: string }): Promise<{ zipPath: string }> =>
      ipcRenderer.invoke('combine:library:export-zip', params),
    openInFinder: (params: { outputRoot: string; topicId: string }): Promise<void> =>
      ipcRenderer.invoke('combine:library:open-in-finder', params)
  },

  pickOutputDir: (): Promise<string | null> => ipcRenderer.invoke('combine:pick-output-dir'),
  pickInputFile: (): Promise<string | null> => ipcRenderer.invoke('combine:pick-input-file')
}

contextBridge.exposeInMainWorld('combine', api)

export type CombineApi = typeof api

/**
 * ДОПОЛНИТЕЛЬНО (не вместо `combine` выше) экспонируем плоский typed-контракт, которого ждут
 * renderer/lib/api.ts + adapters/ipcAdapter.ts (ветка feat/combine-ui, см. src/shared/ipc.ts —
 * `CombineIpcApi`, задокументировано как `window.combineApi`). Направление стыковки и разбивка
 * каналов на «переиспользуемые 1:1» / «новые combine:api:*» — см. docs/DECISIONS.md D-22.
 *
 * Реализация НЕ дублирует бизнес-логику — это тонкий маппинг имён/форм поверх ipcMain-хендлеров
 * (часть — уже существующие выше каналы `combine:*`, часть — новые `combine:api:*`, см.
 * src/main/ipc-handlers.ts#registerFlatApiHandlers и src/main/combine-api-support.ts).
 */
const combineApi: CombineIpcApi = {
  parseText: (raw: string): Promise<ParseTextResult> => ipcRenderer.invoke('combine:parse-text', raw),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('combine:settings:get'),
  saveSettings: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('combine:settings:save', settings),

  // v1.2 (D-23): персистентность API-ключа — переиспользуют СУЩЕСТВУЮЩИЕ каналы вложенного
  // window.combine.settings.* (тот же SettingsService/safeStorage), просто под именами плоского
  // контракта. Ключ никогда не возвращается обратно в renderer — только статус (см. shared/ipc.ts).
  saveApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('combine:settings:set-api-key', apiKey),
  getApiKeyStatus: async (): Promise<ApiKeyStatusResult> => {
    const [status, encryptionAvailable] = await Promise.all([
      ipcRenderer.invoke('combine:settings:api-key-status'),
      ipcRenderer.invoke('combine:settings:is-encryption-available')
    ])
    return { status, encryptionAvailable }
  },
  clearApiKey: (): Promise<void> => ipcRenderer.invoke('combine:settings:clear-api-key'),

  testConnection: (input: TestConnectionInput): Promise<TestConnectionResult> =>
    ipcRenderer.invoke('combine:api:test-connection', input),
  listVoices: (input: ListVoicesInput): Promise<VoiceOption[]> => ipcRenderer.invoke('combine:api:list-voices', input),
  estimateCost: (input: EstimateCostInput): Promise<EstimateCostResult> => ipcRenderer.invoke('combine:api:estimate-cost', input),

  startGeneration: (input: StartGenerationInput): Promise<StartGenerationResult> =>
    ipcRenderer.invoke('combine:api:start-generation', input),
  // pause/resume/cancel игнорируют GenerationRunRef.topicId — main держит ОДИН активный сеанс
  // генерации за раз (см. GenerationSession), явный topicId в контракте — задел на будущее
  // мультисессионности, а не то, от чего сегодня зависит выбор канала.
  pauseGeneration: (_input: GenerationRunRef): Promise<void> => ipcRenderer.invoke('combine:generation:pause'),
  resumeGeneration: (_input: GenerationRunRef): Promise<void> => ipcRenderer.invoke('combine:generation:resume'),
  cancelGeneration: (_input: GenerationRunRef): Promise<void> => ipcRenderer.invoke('combine:generation:cancel'),
  onGenerationProgress: (callback: (event: GenerationProgressEvent) => void): UnsubscribeFn => {
    const listener = (_event: Electron.IpcRendererEvent, payload: GenerationProgressEvent): void => callback(payload)
    ipcRenderer.on('combine:generation:progress', listener)
    return () => ipcRenderer.removeListener('combine:generation:progress', listener)
  },

  listLibrary: (): Promise<LibraryEntry[]> => ipcRenderer.invoke('combine:api:list-library'),
  exportZip: (input: GenerationRunRef): Promise<ExportZipResult> => ipcRenderer.invoke('combine:api:export-zip', input),
  regenerateAll: (input: GenerationRunRef): Promise<StartGenerationResult> => ipcRenderer.invoke('combine:api:regenerate-all', input),
  regenerateFailed: (input: GenerationRunRef): Promise<StartGenerationResult> =>
    ipcRenderer.invoke('combine:api:regenerate-failed', input),
  deleteLesson: (input: GenerationRunRef): Promise<void> => ipcRenderer.invoke('combine:api:delete-lesson', input),
  openLessonFolder: (input: GenerationRunRef): Promise<void> => ipcRenderer.invoke('combine:api:open-lesson-folder', input),

  testSnippet: (input: TestSnippetInput): Promise<TestSnippetResult> => ipcRenderer.invoke('combine:api:test-snippet', input),
  getPhraseAudio: (input: GetPhraseAudioInput): Promise<GetPhraseAudioResult> =>
    ipcRenderer.invoke('combine:api:get-phrase-audio', input),

  /** v1.1 — экспорт урока в Anki .apkg (см. docs/SPEC_COMBINE.md доп. + core/anki/anki-export.service.ts). */
  exportAnki: (input: ExportAnkiInput): Promise<ExportAnkiResult> => ipcRenderer.invoke('combine:api:export-anki', input),

  /** v1.2 (D-23) — см. core/util/ffmpeg.ts. */
  checkFfmpegAvailable: (): Promise<boolean> => ipcRenderer.invoke('combine:api:check-ffmpeg')
}

contextBridge.exposeInMainWorld('combineApi', combineApi)
