/**
 * ipcAdapter — тонкая обёртка над window.combineApi, экспонируемым preload-скриптом внутри Electron
 * (см. src/preload/**, зона другого агента). Сам этот файл НЕ содержит бизнес-логики — только проверку
 * доступности моста и делегирование. Если preload-агент выбрал другое имя моста/форму API, этот файл —
 * единственное место, которое нужно поправить при стыковке (см. docs/DECISIONS.md и src/shared/ipc.ts).
 */

import type { CombineIpcApi } from '../../shared/ipc'

function bridge(): CombineIpcApi {
  if (typeof window === 'undefined' || !window.combineApi) {
    throw new Error(
      'window.combineApi недоступен — preload-мост не экспонирован. ' +
        'Убедитесь, что приложение запущено через Electron (npm run dev / npm run build), а не dev:web.'
    )
  }
  return window.combineApi
}

export const ipcAdapter: CombineIpcApi = {
  parseText: (raw) => bridge().parseText(raw),
  getSettings: () => bridge().getSettings(),
  saveSettings: (settings) => bridge().saveSettings(settings),
  saveApiKey: (apiKey) => bridge().saveApiKey(apiKey),
  getApiKeyStatus: () => bridge().getApiKeyStatus(),
  clearApiKey: () => bridge().clearApiKey(),
  testConnection: (input) => bridge().testConnection(input),
  listVoices: (input) => bridge().listVoices(input),
  estimateCost: (input) => bridge().estimateCost(input),
  startGeneration: (input) => bridge().startGeneration(input),
  pauseGeneration: (input) => bridge().pauseGeneration(input),
  resumeGeneration: (input) => bridge().resumeGeneration(input),
  cancelGeneration: (input) => bridge().cancelGeneration(input),
  onGenerationProgress: (callback) => bridge().onGenerationProgress(callback),
  listLibrary: () => bridge().listLibrary(),
  exportZip: (input) => bridge().exportZip(input),
  regenerateAll: (input) => bridge().regenerateAll(input),
  regenerateFailed: (input) => bridge().regenerateFailed(input),
  deleteLesson: (input) => bridge().deleteLesson(input),
  openLessonFolder: (input) => bridge().openLessonFolder(input),
  testSnippet: (input) => bridge().testSnippet(input),
  getPhraseAudio: (input) => bridge().getPhraseAudio(input),
  exportAnki: (input) => bridge().exportAnki(input),
  checkFfmpegAvailable: () => bridge().checkFfmpegAvailable()
}
