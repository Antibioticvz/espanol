export interface GenerationControlsProps {
  runState: string | undefined
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}

/** Пауза / Возобновить / Отмена — см. docs/SPEC_COMBINE.md §4.3. */
export function GenerationControls({ runState, onPause, onResume, onCancel }: GenerationControlsProps): JSX.Element {
  const isRunning = runState === 'running'
  const isPaused = runState === 'paused'
  const isFinished = runState === 'done' || runState === 'cancelled'

  return (
    <div className="flex justify-center gap-3">
      {isRunning && (
        <button type="button" className="btn-secondary" onClick={onPause}>
          ⏸ Пауза
        </button>
      )}
      {isPaused && (
        <button type="button" className="btn-primary" onClick={onResume}>
          ▶ Возобновить
        </button>
      )}
      <button type="button" className="btn-danger" onClick={onCancel} disabled={isFinished}>
        ⏹ Отмена
      </button>
    </div>
  )
}
