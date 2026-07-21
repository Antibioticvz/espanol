/**
 * ЗАГЛУШКА renderer. Реальные 4 экрана (Импорт/Настройки/Генерация/Библиотека) строятся
 * параллельно в ветке feat/combine-ui — см. коммит-сообщения этой ветки (feat/combine).
 * Этот компонент существует только чтобы `npm run build` и `npm run dev:web` имели точку
 * входа; он будет заменён при merge.
 */
export default function App(): JSX.Element {
  const hasBridge = typeof window !== 'undefined' && 'combine' in window

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-slate-800">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-xl font-semibold">Combine</h1>
        <p className="text-sm text-slate-500">
          Интерфейс в разработке (ветка feat/combine-ui). Main-процесс, сервисы и CLI уже готовы —
          см. combine/README.md.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          IPC-мост {hasBridge ? 'обнаружен (Electron)' : 'не обнаружен (dev:web/браузер)'}.
        </p>
      </div>
    </div>
  )
}
