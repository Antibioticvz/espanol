import type { ParserStats } from '../../../core/types/parsed-lesson'
import { formatNumber } from '../../lib/format'

interface ParseStatsPanelProps {
  stats: ParserStats
  errorCount: number
}

/** Счётчики блоков/фраз/символов — см. docs/SPEC_COMBINE.md §4.1 "✓ Анализ формата". */
export function ParseStatsPanel({ stats, errorCount }: ParseStatsPanelProps): JSX.Element {
  const ok = errorCount === 0
  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Анализ формата</h3>
      <dl className="space-y-1 text-sm text-slate-700">
        <Row label="Блоков" value={formatNumber(stats.blockCount)} />
        <Row label="Фраз" value={formatNumber(stats.phraseCount)} />
        <Row label="Слов лексики" value={formatNumber(stats.vocabCount)} />
        <Row label="Рассказов" value={formatNumber(stats.storyCount)} />
        <Row label="Символов ES" value={formatNumber(stats.charactersEs)} />
        <Row label="Символов RU" value={formatNumber(stats.charactersRu)} />
        <Row label="Символов всего" value={formatNumber(stats.totalCharacters)} />
      </dl>
      <p className={ok ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-red-700'}>
        Ошибок: {errorCount}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}
