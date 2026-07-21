import type { UseGenerationReturn } from '../../hooks/useGeneration'
import { OverallProgressBar } from './OverallProgressBar'
import { CurrentItemPanel } from './CurrentItemPanel'
import { StatsRow } from './StatsRow'
import { BlockTree } from './BlockTree'
import { LiveLog } from './LiveLog'
import { GenerationControls } from './GenerationControls'

export interface GenerationScreenProps {
  generation: UseGenerationReturn
  onBack: () => void
  onOpenLibrary: () => void
}

function runStateLabel(state: string | undefined): string {
  switch (state) {
    case 'running':
      return 'Генерация выполняется…'
    case 'paused':
      return 'На паузе'
    case 'done':
      return '✓ Готово'
    case 'cancelled':
      return 'Отменено пользователем'
    default:
      return 'Ожидание запуска…'
  }
}

/** Экран 3/4: прогресс и управление генерацией (см. docs/SPEC_COMBINE.md §4.3). */
export function GenerationScreen({ generation, onBack, onOpenLibrary }: GenerationScreenProps): JSX.Element {
  const { lesson, tree, progress, logs, pause, resume, cancel } = generation

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <p className="text-sm font-medium text-brand-600">Шаг 3 из 4</p>
        <h1 className="text-xl font-semibold text-slate-900">
          Генерация{lesson ? `: ${lesson.title_ru}` : ''}
        </h1>
        <p className="text-sm text-slate-500">{runStateLabel(progress?.runState)}</p>
      </header>

      {!lesson ? (
        <div className="card text-sm text-slate-500">
          Генерация ещё не запущена. Вернитесь на экран настроек и нажмите «Генерировать».
        </div>
      ) : (
        <>
          <OverallProgressBar progress={progress} />
          <CurrentItemPanel progress={progress} />
          <StatsRow progress={progress} />
          <BlockTree blocks={tree} />
          <LiveLog logs={logs} />
          <GenerationControls runState={progress?.runState} onPause={pause} onResume={resume} onCancel={cancel} />
        </>
      )}

      <div className="flex justify-between border-t border-slate-200 pt-4">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Назад к настройкам
        </button>
        <button type="button" className="btn-secondary" onClick={onOpenLibrary}>
          Библиотека →
        </button>
      </div>
    </div>
  )
}
