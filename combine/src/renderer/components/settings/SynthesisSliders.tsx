export interface SynthesisSlidersProps {
  stability: number
  similarityBoost: number
  seed: number | null
  onChange: (patch: { stability?: number; similarityBoost?: number; seed?: number | null }) => void
}

/** Параметры синтеза ElevenLabs — stability/similarity_boost/seed (см. docs/SPEC_COMBINE.md §4.2). */
export function SynthesisSliders({ stability, similarityBoost, seed, onChange }: SynthesisSlidersProps): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <label className="field-label">Стабильность (stability): {stability.toFixed(2)}</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={stability}
          aria-label="Стабильность"
          onChange={(e) => onChange({ stability: Number(e.target.value) })}
          className="w-full"
        />
        <p className="field-hint">0.0 — более вариативен · 1.0 — монотонен</p>
      </div>
      <div>
        <label className="field-label">Сходство голоса (similarity_boost): {similarityBoost.toFixed(2)}</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={similarityBoost}
          aria-label="Сходство голоса"
          onChange={(e) => onChange({ similarityBoost: Number(e.target.value) })}
          className="w-full"
        />
        <p className="field-hint">0.0 — более экспрессивен · 1.0 — точнее копирует голос</p>
      </div>
      <div>
        <label className="field-label">Seed (для воспроизводимости)</label>
        <input
          type="number"
          className="text-input"
          value={seed ?? ''}
          placeholder="пусто = случайный"
          onChange={(e) => onChange({ seed: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </div>
    </div>
  )
}
