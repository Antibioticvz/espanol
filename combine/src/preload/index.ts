import { contextBridge, ipcRenderer } from 'electron'
import type { ParseResult } from '../core/types/parsed-lesson'
import type { AppSettings } from '../core/types/settings'
import type { GenerationProgressEvent, QueueConfig } from '../core/types/generation'
import type { Provider } from '../core/types/lesson-json'
import type { TtsModel, TtsVoice } from '../core/tts/tts-provider'
import type { LessonSummary } from '../core/file/file.service'
import type { TestGenerationParams, TestGenerationResult } from '../main/test-generation'

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
