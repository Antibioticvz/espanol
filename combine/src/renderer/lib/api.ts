import type { CombineIpcApi } from '../../shared/ipc'
import { ipcAdapter } from '../adapters/ipcAdapter'
import { mockAdapter } from '../adapters/mockAdapter'

/**
 * Выбор адаптера по среде выполнения (см. docs/DECISIONS.md D-09):
 *  - внутри Electron (npm run dev / build) preload экспонирует window.combineApi → используем ipcAdapter;
 *  - в обычном браузере (npm run dev:web, а также vitest/jsdom в тестах) моста нет → mockAdapter.
 * Проверяем именно наличие моста, а не import.meta.env.DEV — так работает одинаково для dev:web, build-превью
 * в браузере и unit-тестов, без завязки на способ сборки.
 */
function selectApi(): CombineIpcApi {
  if (typeof window !== 'undefined' && window.combineApi) {
    return ipcAdapter
  }
  return mockAdapter
}

export const api: CombineIpcApi = selectApi()
