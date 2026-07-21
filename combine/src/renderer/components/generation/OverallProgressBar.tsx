import type { GenerationProgressEvent } from '../../../core/types/generation'
import { formatPercent } from '../../lib/format'

export function OverallProgressBar({ progress }: { progress: GenerationProgressEvent | null }): JSX.Element {
  const total = progress?.totalItems ?? 0
  const done = progress?.doneItems ?? 0
  const ratio = total > 0 ? done / total : 0
  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Общий прогресс</h3>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-brand-600 transition-all" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="mt-1 text-sm text-slate-600" data-testid="overall-progress-label">
        {formatPercent(ratio)} ({done} / {total} фраз)
      </p>
    </div>
  )
}
