import type { GenerationProgressEvent } from '../../../core/types/generation'
import { formatDurationSeconds, formatUsd } from '../../lib/format'

export function StatsRow({ progress }: { progress: GenerationProgressEvent | null }): JSX.Element {
  return (
    <div className="card grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Stat label="Скорость" value={`${(progress?.speedPerMin ?? 0).toFixed(1)} фраз/мин`} />
      <Stat label="Осталось" value={formatDurationSeconds(progress?.etaSeconds ?? null)} />
      <Stat label="Прошло" value={formatDurationSeconds(progress ? progress.elapsedMs / 1000 : null)} />
      <Stat label="Потрачено" value={formatUsd(progress?.spentUsd ?? 0)} />
      <Stat label="Успешно" value={String(progress?.doneItems ?? 0)} tone="text-green-700" />
      <Stat
        label="Ошибок"
        value={String(progress?.failedItems ?? 0)}
        tone={progress && progress.failedItems > 0 ? 'text-red-700' : undefined}
      />
      <Stat label="В очереди" value={String(progress?.pendingItems ?? 0)} />
      <Stat label="Генерируется" value={String(progress?.generatingItems ?? 0)} />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-medium ${tone ?? 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
