export type ScreenKey = 'import' | 'settings' | 'generation' | 'library'

export interface StepNavProps {
  current: ScreenKey
  onNavigate: (screen: ScreenKey) => void
  canGoSettings: boolean
  canGoGeneration: boolean
}

const STEPS: Array<{ key: ScreenKey; label: string }> = [
  { key: 'import', label: '1. Импорт' },
  { key: 'settings', label: '2. Настройки' },
  { key: 'generation', label: '3. Генерация' },
  { key: 'library', label: '4. Библиотека' }
]

/** Простая навигация-степпер между 4 экранами (см. docs/DECISIONS.md D-09 — без react-router). */
export function StepNav({ current, onNavigate, canGoSettings, canGoGeneration }: StepNavProps): JSX.Element {
  const isEnabled = (key: ScreenKey): boolean => {
    if (key === 'settings') return canGoSettings
    if (key === 'generation') return canGoGeneration
    return true
  }

  return (
    <nav className="flex gap-1 border-b border-slate-200 bg-white px-4">
      {STEPS.map((step) => {
        const enabled = isEnabled(step.key)
        const active = current === step.key
        return (
          <button
            key={step.key}
            type="button"
            disabled={!enabled}
            onClick={() => onNavigate(step.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-brand-600 text-brand-700'
                : enabled
                  ? 'border-transparent text-slate-500 hover:text-slate-700'
                  : 'cursor-not-allowed border-transparent text-slate-300'
            }`}
          >
            {step.label}
          </button>
        )
      })}
    </nav>
  )
}
