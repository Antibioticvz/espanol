import { useMemo, useState } from 'react'
import type { StartGenerationResult } from '../../../shared/ipc'
import { useLibraryQuery } from '../../hooks/useLibrary'
import { LibraryFilters, type LibraryFilter, type LibrarySort } from './LibraryFilters'
import { LessonCard } from './LessonCard'
import { LibraryStatsFooter } from './LibraryStatsFooter'

export interface LibraryScreenProps {
  onBack: () => void
  onGenerationStarted: (result: StartGenerationResult) => void
}

/** Экран 4/4: библиотека завершённых уроков (см. docs/SPEC_COMBINE.md §4.4). */
export function LibraryScreen({ onBack, onGenerationStarted }: LibraryScreenProps): JSX.Element {
  const { data, isLoading } = useLibraryQuery()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>('date')

  const entries = useMemo(() => {
    const all = data ?? []
    const filtered = filter === 'all' ? all : all.filter((e) => e.status === filter)
    return [...filtered].sort((a, b) => {
      if (sort === 'size') return (b.sizeMb ?? 0) - (a.sizeMb ?? 0)
      if (sort === 'topic') return a.lesson.topic_number - b.lesson.topic_number
      return new Date(b.lesson.created_at).getTime() - new Date(a.lesson.created_at).getTime()
    })
  }, [data, filter, sort])

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <p className="text-sm font-medium text-brand-600">Шаг 4 из 4</p>
        <h1 className="text-xl font-semibold text-slate-900">Библиотека уроков</h1>
      </header>

      <LibraryFilters filter={filter} sort={sort} onFilterChange={setFilter} onSortChange={setSort} />

      {isLoading && <p className="text-sm text-slate-500">Загрузка библиотеки…</p>}
      {!isLoading && entries.length === 0 && <p className="text-sm text-slate-500">Уроков не найдено.</p>}

      <div className="space-y-3">
        {entries.map((entry) => (
          <LessonCard key={entry.lesson.topic_id} entry={entry} onGenerationStarted={onGenerationStarted} />
        ))}
      </div>

      {data && data.length > 0 && <LibraryStatsFooter entries={data} />}

      <div className="flex justify-start border-t border-slate-200 pt-4">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Назад к генерации
        </button>
      </div>
    </div>
  )
}
