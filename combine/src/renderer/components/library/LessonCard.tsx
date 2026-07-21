import { useState } from 'react'
import type { LibraryEntry, StartGenerationResult } from '../../../shared/ipc'
import { useLibraryActions } from '../../hooks/useLibrary'
import { formatBytes, formatDateTime, formatUsd } from '../../lib/format'
import { listPlayablePhrases } from '../../lib/lessonTree'
import { PhrasePlayer } from './PhrasePlayer'
import { LessonJsonModal } from './LessonJsonModal'

export interface LessonCardProps {
  entry: LibraryEntry
  onGenerationStarted: (result: StartGenerationResult) => void
}

const STATUS_LABEL: Record<string, string> = {
  done: '✓ Готово',
  in_progress: '⏳ В процессе',
  failed: '⚠ Ошибка',
  empty: '—'
}

/** Карточка урока в библиотеке — метаданные, действия, встроенный плеер (см. docs/SPEC_COMBINE.md §4.4). */
export function LessonCard({ entry, onGenerationStarted }: LessonCardProps): JSX.Element {
  const { lesson, status, sizeMb } = entry
  const [menuOpen, setMenuOpen] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [showPlayer, setShowPlayer] = useState(false)
  const actions = useLibraryActions()

  const playablePhrases = listPlayablePhrases(lesson, 3)

  return (
    <div className="card space-y-2" data-testid={`lesson-card-${lesson.topic_id}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {lesson.title_ru} (Тема {String(lesson.topic_number).padStart(2, '0')})
          </h3>
          <p className="text-sm text-slate-500">
            {lesson.stats.phrase_count} фраз · {lesson.stats.vocab_count} слов · {STATUS_LABEL[status] ?? status}
          </p>
        </div>
        <div className="relative">
          <button type="button" className="btn-secondary" onClick={() => setMenuOpen((v) => !v)}>
            ⋯ Ещё
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
              <MenuItem
                label="Экспорт ZIP"
                onClick={() => {
                  setMenuOpen(false)
                  actions.exportZip.mutate({ topicId: lesson.topic_id })
                }}
              />
              <MenuItem
                label="Просмотр JSON"
                onClick={() => {
                  setMenuOpen(false)
                  setShowJson(true)
                }}
              />
              <MenuItem
                label="Скопировать в буфер (JSON)"
                onClick={() => {
                  setMenuOpen(false)
                  void navigator.clipboard?.writeText(JSON.stringify(lesson, null, 2))
                }}
              />
              <MenuItem
                label="Переделать всё"
                onClick={() => {
                  setMenuOpen(false)
                  actions.regenerateAll.mutate({ topicId: lesson.topic_id }, { onSuccess: onGenerationStarted })
                }}
              />
              <MenuItem
                label="Переделать failed"
                onClick={() => {
                  setMenuOpen(false)
                  actions.regenerateFailed.mutate({ topicId: lesson.topic_id }, { onSuccess: onGenerationStarted })
                }}
              />
              <MenuItem
                label="Открыть в Finder"
                onClick={() => {
                  setMenuOpen(false)
                  actions.openLessonFolder.mutate({ topicId: lesson.topic_id })
                }}
              />
              <MenuItem
                label="Удалить урок"
                danger
                onClick={() => {
                  setMenuOpen(false)
                  actions.deleteLesson.mutate({ topicId: lesson.topic_id })
                }}
              />
            </div>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-1 text-sm text-slate-600 sm:grid-cols-4">
        <Row label="Дата" value={formatDateTime(lesson.created_at)} />
        <Row label="Размер" value={formatBytes(sizeMb)} />
        <Row label="Модель" value={lesson.config.model} />
        <Row label="Стоимость" value={formatUsd(lesson.stats.actual_cost_usd ?? lesson.stats.estimated_cost_usd ?? 0)} />
      </dl>
      <p className="text-xs text-slate-500">
        Голоса: {lesson.config.voice_es.name} (ES) / {lesson.config.voice_ru.name} (RU)
      </p>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2">
        {status === 'in_progress' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => actions.regenerateFailed.mutate({ topicId: lesson.topic_id }, { onSuccess: onGenerationStarted })}
          >
            ▶ Возобновить
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={() => setShowPlayer((v) => !v)}>
          🎵 {showPlayer ? 'Скрыть плеер' : 'Проиграть'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => actions.openLessonFolder.mutate({ topicId: lesson.topic_id })}>
          📂 Папка
        </button>
      </div>

      {showPlayer && (
        <div className="space-y-1 border-t border-slate-100 pt-2">
          {playablePhrases.map((p) => (
            <div key={p.id} className="flex flex-wrap gap-2">
              <PhrasePlayer topicId={lesson.topic_id} phraseId={p.id} lang="es" label={`ES: ${p.es}`} />
              <PhrasePlayer topicId={lesson.topic_id} phraseId={p.id} lang="ru" label={`RU: ${p.ru}`} />
            </div>
          ))}
        </div>
      )}

      {showJson && <LessonJsonModal lesson={lesson} onClose={() => setShowJson(false)} />}
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 ${danger ? 'text-red-600' : 'text-slate-700'}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  )
}
