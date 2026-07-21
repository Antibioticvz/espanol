export function LiveLog({ logs }: { logs: string[] }): JSX.Element {
  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Живой лог</h3>
      <div
        className="h-48 overflow-y-auto rounded-md bg-slate-900 p-2 font-mono text-xs text-slate-100"
        data-testid="live-log"
      >
        {logs.length === 0 ? (
          <p className="text-slate-500">Пока пусто…</p>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  )
}
