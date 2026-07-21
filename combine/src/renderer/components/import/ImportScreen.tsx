import { useState } from 'react'
import type { ParsedLesson, ParserStats } from '../../../core/types/parsed-lesson'
import { useParsedLesson } from '../../hooks/useParsedLesson'
import { SourceInput } from './SourceInput'
import { ParseStatsPanel } from './ParseStatsPanel'
import { ParseTree } from './ParseTree'
import { ParseErrorList } from './ParseErrorList'

export interface ImportScreenProps {
  initialText?: string
  onNext: (lesson: ParsedLesson, stats: ParserStats) => void
}

/** Экран 1/4: импорт текста урока с live-парсингом (см. docs/SPEC_COMBINE.md §4.1). */
export function ImportScreen({ initialText = '', onNext }: ImportScreenProps): JSX.Element {
  const [rawText, setRawText] = useState(initialText)
  const { data, isPending } = useParsedLesson(rawText)

  const lesson = data?.lesson ?? null
  const errors = data?.errors ?? []
  const warnings = data?.warnings ?? []
  const hasContent = rawText.trim().length > 0
  const canProceed = Boolean(lesson) && errors.length === 0 && hasContent

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <p className="text-sm font-medium text-brand-600">Шаг 1 из 4</p>
        <h1 className="text-xl font-semibold text-slate-900">Импорт урока</h1>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SourceInput value={rawText} onChange={setRawText} />
        <div className="space-y-4">
          {hasContent && data ? (
            <ParseStatsPanel stats={data.stats} errorCount={errors.length} />
          ) : (
            <div className="card text-sm text-slate-500">Вставьте текст или загрузите файл, чтобы увидеть разбор.</div>
          )}
          {isPending && hasContent && <p className="text-xs text-slate-400">Обновление разбора…</p>}
        </div>
      </div>

      {lesson && <ParseTree lesson={lesson} />}
      {hasContent && data && <ParseErrorList errors={errors} warnings={warnings} />}

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
        <p className="text-sm text-slate-600">
          Статус:{' '}
          {canProceed ? (
            <span className="font-medium text-green-700">✓ Готово к генерации</span>
          ) : (
            <span className="font-medium text-slate-500">Ожидание корректного текста</span>
          )}
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={!canProceed}
          onClick={() => lesson && data && onNext(lesson, data.stats)}
        >
          Далее →
        </button>
      </div>
    </div>
  )
}
