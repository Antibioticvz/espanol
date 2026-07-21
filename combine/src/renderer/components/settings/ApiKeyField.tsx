import { useState } from 'react'

export interface ApiKeyFieldProps {
  value: string | null
  onChange: (value: string | null) => void
}

function maskKey(value: string): string {
  if (value.length <= 4) return '•'.repeat(value.length)
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`
}

/**
 * API-ключ ElevenLabs — маскированный ввод. Хранится ТОЛЬКО в памяти renderer на время сессии: AppSettings
 * (core/types/settings.ts) сознательно не персистит ключ — в реальном приложении это Keychain через
 * electron-safe-storage (см. docs/SPEC_COMBINE.md §3.1), задача main-процесса, а не renderer.
 */
export function ApiKeyField({ value, onChange }: ApiKeyFieldProps): JSX.Element {
  const [editing, setEditing] = useState(!value)

  return (
    <div>
      <label className="field-label">API-ключ ElevenLabs</label>
      <div className="flex gap-2">
        {editing ? (
          <input
            type="password"
            autoFocus
            className="text-input"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            onBlur={() => setEditing(false)}
            placeholder="sk-..."
            aria-label="API-ключ ElevenLabs"
          />
        ) : (
          <div className="text-input flex items-center bg-slate-50 text-slate-500">
            {value ? maskKey(value) : 'Ключ не задан'}
          </div>
        )}
        <button type="button" className="btn-secondary shrink-0" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Готово' : 'Изменить'}
        </button>
      </div>
      <p className="field-hint">Хранится только в памяти этой сессии. Пусто — работает mock-провайдер.</p>
    </div>
  )
}
