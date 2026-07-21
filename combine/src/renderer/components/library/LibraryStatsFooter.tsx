import type { LibraryEntry } from '../../../shared/ipc'
import { formatBytes, formatNumber, formatUsd } from '../../lib/format'

/** Статистика по всем урокам (см. docs/SPEC_COMBINE.md §4.4, нижний блок). */
export function LibraryStatsFooter({ entries }: { entries: LibraryEntry[] }): JSX.Element {
  const done = entries.filter((e) => e.status === 'done')
  const totalElements = entries.reduce((sum, e) => sum + e.lesson.stats.total_elements, 0)
  const totalChars = entries.reduce((sum, e) => sum + e.lesson.stats.total_characters, 0)
  const totalSpent = entries.reduce((sum, e) => sum + (e.lesson.stats.actual_cost_usd ?? 0), 0)
  const totalSizeMb = entries.reduce((sum, e) => sum + (e.sizeMb ?? 0), 0)

  return (
    <div className="card" data-testid="library-stats-footer">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">📊 Статистика по всем урокам</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-700 sm:grid-cols-3">
        <Row label="Готовых" value={String(done.length)} />
        <Row label="Всего элементов" value={formatNumber(totalElements)} />
        <Row label="Всего символов" value={formatNumber(totalChars)} />
        <Row label="Потрачено денег" value={formatUsd(totalSpent)} />
        <Row label="Общий размер" value={formatBytes(totalSizeMb)} />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
