import type { GenerationProgressEvent } from '../../../core/types/generation'

export function CurrentItemPanel({ progress }: { progress: GenerationProgressEvent | null }): JSX.Element | null {
  if (!progress || !progress.currentItemId || progress.runState !== 'running') return null
  return (
    <div className="card">
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Текущий элемент</h3>
      <p className="text-sm text-slate-700">💬 {progress.currentItemId}</p>
      {progress.currentText && <p className="truncate text-sm text-slate-500">«{progress.currentText}»</p>}
    </div>
  )
}
