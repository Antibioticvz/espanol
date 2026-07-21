import { useRef } from 'react'
import type { VoiceOption } from '../../../shared/ipc'

export interface VoiceSelectProps {
  label: string
  voices: VoiceOption[]
  value: { id: string; name: string } | null
  onChange: (voice: { id: string; name: string }) => void
}

/** Dropdown голоса + кнопка прослушать preview (см. docs/SPEC_COMBINE.md §4.2, docs/DECISIONS.md D-02). */
export function VoiceSelect({ label, voices, value, onChange }: VoiceSelectProps): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const selected = voices.find((v) => v.id === value?.id) ?? voices[0]

  const handlePreview = (): void => {
    if (selected?.previewUrl && audioRef.current) {
      audioRef.current.src = selected.previewUrl
      void audioRef.current.play()
    }
  }

  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="flex gap-2">
        <select
          className="text-input"
          aria-label={label}
          value={selected?.id ?? ''}
          onChange={(e) => {
            const next = voices.find((voice) => voice.id === e.target.value)
            if (next) onChange({ id: next.id, name: next.name })
          }}
        >
          {voices.length === 0 && <option value="">Нет доступных голосов</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.labels?.accent ? ` (${v.labels.accent})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={handlePreview}
          disabled={!selected?.previewUrl}
        >
          🔊 Слушать
        </button>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} className="hidden" data-testid={`voice-preview-${label}`} />
    </div>
  )
}
