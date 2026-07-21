export type LibraryFilter = 'all' | 'done' | 'in_progress' | 'failed'
export type LibrarySort = 'date' | 'size' | 'topic'

export interface LibraryFiltersProps {
  filter: LibraryFilter
  sort: LibrarySort
  onFilterChange: (filter: LibraryFilter) => void
  onSortChange: (sort: LibrarySort) => void
}

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: 'Все',
  done: 'Готовые',
  in_progress: 'В процессе',
  failed: 'Ошибки'
}

const SORT_LABELS: Record<LibrarySort, string> = {
  date: 'По дате',
  size: 'По размеру',
  topic: 'По теме'
}

/** Фильтр по статусу + сортировка (см. docs/SPEC_COMBINE.md §4.4). */
export function LibraryFilters({ filter, sort, onFilterChange, onSortChange }: LibraryFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-3 text-sm" role="group" aria-label="Фильтр">
        {(Object.keys(FILTER_LABELS) as LibraryFilter[]).map((key) => (
          <label key={key} className="flex items-center gap-1">
            <input type="radio" name="library-filter" checked={filter === key} onChange={() => onFilterChange(key)} />
            {FILTER_LABELS[key]}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Сортировка:
        <select className="text-input" value={sort} onChange={(e) => onSortChange(e.target.value as LibrarySort)}>
          {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
