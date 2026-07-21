import { useState } from 'react'
import { useApiKeyStatusQuery, useClearApiKeyMutation, useSaveApiKeyMutation } from '../../hooks/useApiKey'

export interface ApiKeyFieldProps {
  value: string | null
  onChange: (value: string | null) => void
}

/**
 * API-ключ ElevenLabs (v1.2, D-23) — теперь два независимых состояния:
 *  - «печатается» (value/onChange, временное состояние ЭТОГО экрана — нужно, чтобы «Проверить
 *    подключение»/«Сгенерировать тест» на этом же экране могли использовать ключ ДО сохранения);
 *  - «сохранён» (useApiKeyStatusQuery — main хранит ключ шифрованным через safeStorage; сюда
 *    приходит ТОЛЬКО статус, никогда сам ключ — см. shared/ipc.ts#ApiKeyStatusResult).
 * После успешного «Сохранить» локальное value очищается (onChange(null)): дальше startGeneration/
 * testSnippet/... передают apiKey: null и main сам берёт сохранённый ключ (стыковано в D-22/D-23).
 */
export function ApiKeyField({ value, onChange }: ApiKeyFieldProps): JSX.Element {
  const statusQuery = useApiKeyStatusQuery()
  const saveMutation = useSaveApiKeyMutation()
  const clearMutation = useClearApiKeyMutation()
  const [editing, setEditing] = useState(false)

  const status = statusQuery.data?.status ?? 'none'
  const hasSavedKey = status === 'ok'
  const showInput = editing || !hasSavedKey

  const handleSave = (): void => {
    const trimmed = value?.trim()
    if (!trimmed) return
    saveMutation.mutate(trimmed, {
      onSuccess: () => {
        onChange(null)
        setEditing(false)
      }
    })
  }

  const handleClear = (): void => {
    clearMutation.mutate(undefined, {
      onSuccess: () => {
        onChange(null)
        setEditing(true)
      }
    })
  }

  return (
    <div>
      <label className="field-label">API-ключ ElevenLabs</label>

      {showInput ? (
        <div className="flex gap-2">
          <input
            type="password"
            autoFocus
            className="text-input"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="sk-..."
            aria-label="API-ключ ElevenLabs"
          />
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={handleSave}
            disabled={!value?.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
          {hasSavedKey && (
            <button type="button" className="btn-secondary shrink-0" onClick={() => setEditing(false)}>
              Отмена
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="text-input flex items-center bg-slate-50 text-slate-500" data-testid="api-key-saved-badge">
            •••••••• (ключ сохранён)
          </div>
          <button type="button" className="btn-secondary shrink-0" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button
            type="button"
            className="btn-secondary shrink-0 text-red-600"
            onClick={handleClear}
            disabled={clearMutation.isPending}
            data-testid="delete-api-key"
          >
            {clearMutation.isPending ? 'Удаление…' : 'Удалить ключ'}
          </button>
        </div>
      )}

      {status === 'corrupted' && (
        <p className="field-hint text-red-600">Сохранённый ключ повреждён (не расшифровывается) — введите заново.</p>
      )}
      {status === 'encryption-unavailable' && (
        <p className="field-hint text-amber-600">
          Шифрованное хранилище недоступно на этой сборке/платформе — ключ будет использован только в рамках
          текущего запуска, сохранить на диск не получится.
        </p>
      )}
      {saveMutation.isError && (
        <p className="field-hint text-red-600">Не удалось сохранить ключ: {(saveMutation.error as Error).message}</p>
      )}
      {!hasSavedKey && status !== 'corrupted' && status !== 'encryption-unavailable' && (
        <p className="field-hint">Сохранённый ключ используется автоматически при генерации/тестах — вводить заново не нужно.</p>
      )}
    </div>
  )
}
