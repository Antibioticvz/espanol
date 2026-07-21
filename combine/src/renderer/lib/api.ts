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
 * ИЗВЕСТНОЕ РАСХОЖДЕНИЕ (см. отчёт renderer-агента): фактический preload из feat/combine
 * (src/preload/index.ts) экспонирует мост как `window.combine` с ВЛОЖЕННОЙ структурой методов
 * (settings.get/save, generation.start/pause/..., library.list/delete/...) и другой моделью
 * API-ключа (setApiKey/hasApiKey/clearApiKey вместо apiKey отдельным полем в каждом вызове) —
 * не как плоский `window.combineApi`, предложенный в src/shared/ipc.ts. Это осознанно НЕ
 * исправлено здесь: примирение — самостоятельная задача оркестратора («финальную стыковку
 * каналов сделает оркестратор при merge»), а не косметическое переименование (меняется форма
 * нескольких операций, не только имена). До реконсиляции реальный Electron-бридж просто не
 * находится и используется mockAdapter — предупреждение ниже делает это явным, а не тихим.
 */
function selectApi(): CombineIpcApi {
  if (typeof window !== 'undefined' && window.combineApi) {
    return ipcAdapter
  }
  if (typeof window !== 'undefined' && 'combine' in window) {
    // eslint-disable-next-line no-console
    console.warn(
      '[lib/api] window.combine обнаружен (реальный preload из feat/combine), но его форма не совпадает ' +
        'с CombineIpcApi (src/shared/ipc.ts) — ожидались плоские методы на window.combineApi. ' +
        'Используется mockAdapter, пока каналы не согласованы (см. docs/DECISIONS.md и отчёт при merge).'
    )
  }
  return mockAdapter
}

export const api: CombineIpcApi = selectApi()
