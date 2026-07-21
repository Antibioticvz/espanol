import type { LessonJson } from '../../../core/types/lesson-json'

export interface LessonJsonModalProps {
  lesson: LessonJson | null
  onClose: () => void
}

/** Просмотр lesson.json «в редакторе» — реализовано как модалка на клиенте, без отдельного IPC-вызова. */
export function LessonJsonModal({ lesson, onClose }: LessonJsonModalProps): JSX.Element | null {
  if (!lesson) return null
  const json = JSON.stringify(lesson, null, 2)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`lesson.json — ${lesson.topic_id}`}
    >
      <div
        className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">lesson.json — {lesson.topic_id}</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(json)}>
              Скопировать
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
        <pre className="whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-xs text-slate-100">{json}</pre>
      </div>
    </div>
  )
}
