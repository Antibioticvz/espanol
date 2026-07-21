import type { CombineIpcApi } from '../shared/ipc'

/**
 * Соглашение о мосте preload → renderer (см. комментарий в src/shared/ipc.ts):
 * main/preload-агент ожидается экспонирующим typed IPC-контракт как `window.combineApi`
 * через `contextBridge.exposeInMainWorld('combineApi', api)`. В dev:web (обычный браузер,
 * без Electron) этот объект отсутствует — тогда используется mockAdapter (см. lib/api.ts).
 */
declare global {
  interface Window {
    combineApi?: CombineIpcApi
  }
}

export {}
