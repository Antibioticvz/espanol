import type { CombineIpcApi } from '../../shared/ipc'
import { ipcAdapter } from '../adapters/ipcAdapter'
import { mockAdapter } from '../adapters/mockAdapter'

/**
 * Выбор адаптера по среде выполнения (см. docs/DECISIONS.md D-09):
 *  - внутри Electron (npm run dev / build) preload экспонирует window.combineApi → используем ipcAdapter;
 *  - в обычном браузере (npm run dev:web, а также vitest/jsdom в тестах) моста нет → mockAdapter.
 * Проверяем именно наличие моста, а не import.meta.env.DEV — так работает одинаково для dev:web, build-превью
 * в браузере и unit-тестов, без завязки на способ сборки.
 *
 * СТЫКОВКА (docs/DECISIONS.md D-22): реальный preload (src/preload/index.ts) экспонирует ОБА моста —
 * исторический вложенный `window.combine` (settings.get/save, generation.start/pause/...,
 * library.list/delete/...) И плоский `window.combineApi`, реализующий именно CombineIpcApi отсюда,
 * поверх тех же main-хендлеров (часть — общие каналы, часть — новые combine:api:*, см.
 * src/main/ipc-handlers.ts). Поэтому в реальном Electron window.combineApi ВСЕГДА присутствует —
 * ветка ниже с warn() при обнаружении только window.combine остаётся исключительно defensive-кодом
 * на случай будущей регрессии (напр. preload случайно перестанет регистрировать combineApi), а не
 * ожидаемым путём выполнения.
 */
function selectApi(): CombineIpcApi {
  if (typeof window !== 'undefined' && window.combineApi) {
    return ipcAdapter
  }
  if (typeof window !== 'undefined' && 'combine' in window) {
    // eslint-disable-next-line no-console
    console.warn(
      '[lib/api] window.combine обнаружен, но window.combineApi — нет. Ожидался плоский мост ' +
        'CombineIpcApi (см. src/preload/index.ts и docs/DECISIONS.md D-22). Используется mockAdapter ' +
        'как safe fallback — проверьте preload (возможно, устаревшая сборка out/preload).'
    )
  }
  return mockAdapter
}

export const api: CombineIpcApi = selectApi()
