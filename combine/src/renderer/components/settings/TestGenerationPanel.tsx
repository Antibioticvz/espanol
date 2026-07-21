import { useState } from 'react'
import type { Provider } from '../../../core/types/lesson-json'
import { DEFAULT_TEST_TEXT } from '../../../core/types/settings'
import type { VoiceOption } from '../../../shared/ipc'
import { useTestSnippetMutation } from '../../hooks/useTestSnippet'
import { formatUsd } from '../../lib/format'

export interface TestGenerationPanelProps {
  provider: Provider
  model: string
  apiKey: string | null
  voices: VoiceOption[]
  defaultVoiceId?: string
  stability: number
  similarityBoost: number
}

/** D-05: дешёвая тестовая генерация одной фразы — проверка ключа/голоса перед дорогой генерацией темы. */
export function TestGenerationPanel({
  provider,
  model,
  apiKey,
  voices,
  defaultVoiceId,
  stability,
  similarityBoost
}: TestGenerationPanelProps): JSX.Element {
  const [text, setText] = useState(DEFAULT_TEST_TEXT)
  const [voiceId, setVoiceId] = useState(defaultVoiceId ?? voices[0]?.id ?? '')
  const mutation = useTestSnippetMutation()

  const selectedVoice = voices.find((v) => v.id === voiceId) ?? voices[0]
  const lang = selectedVoice?.labels?.language === 'ru' ? 'ru' : 'es'

  const handleGenerate = (): void => {
    if (!selectedVoice || !text.trim()) return
    mutation.mutate({
      text,
      lang,
      voiceId: selectedVoice.id,
      voiceName: selectedVoice.name,
      provider,
      model,
      apiKey,
      stability,
      similarityBoost
    })
  }

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Тестовая генерация</h3>
      <p className="field-hint">Проверьте ключ, голос и качество звучания перед запуском генерации всей темы.</p>
      <div>
        <label className="field-label">Текст</label>
        <input
          type="text"
          className="text-input"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Голос</label>
        <select className="text-input" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.labels?.language ? ` (${v.labels.language.toUpperCase()})` : ''}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={handleGenerate}
        disabled={mutation.isPending || !text.trim() || !selectedVoice}
      >
        {mutation.isPending ? 'Генерация…' : '▶ Сгенерировать тест'}
      </button>

      {mutation.isError && <p className="text-sm text-red-700">Ошибка: {(mutation.error as Error).message}</p>}

      {mutation.data && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={mutation.data.audioDataUrl} className="w-full" data-testid="test-snippet-audio" />
          <p className="text-sm text-slate-600">
            Длительность: {(mutation.data.durationMs / 1000).toFixed(1)} сек · Символов: {mutation.data.characters} ·
            Стоимость: {formatUsd(mutation.data.costUsd)}
          </p>
        </div>
      )}
    </div>
  )
}
