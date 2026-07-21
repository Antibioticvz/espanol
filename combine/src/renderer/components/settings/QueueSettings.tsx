import type { AppSettings } from '../../../core/types/settings'

export interface QueueSettingsProps {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

/** Папка вывода + параметры очереди генерации (см. docs/SPEC_COMBINE.md §4.2, правая панель). */
export function QueueSettings({ settings, onChange }: QueueSettingsProps): JSX.Element {
  const { queue } = settings
  const updateQueue = (patch: Partial<AppSettings['queue']>): void => onChange({ queue: { ...queue, ...patch } })

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label">Папка вывода</label>
        <input
          type="text"
          className="text-input"
          value={settings.outputDir}
          onChange={(e) => onChange({ outputDir: e.target.value })}
        />
      </div>
      <div>
        <label className="field-label">Параллельные запросы: {queue.concurrency}</label>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={queue.concurrency}
          aria-label="Параллельные запросы"
          onChange={(e) => updateQueue({ concurrency: Number(e.target.value) })}
          className="w-full"
        />
        <p className="field-hint">Больше — быстрее, но выше риск 429 (мин 1, макс 5)</p>
      </div>
      <div>
        <label className="field-label">Макс попыток (max retries)</label>
        <input
          type="number"
          min={1}
          max={10}
          className="text-input"
          value={queue.maxRetries}
          onChange={(e) => updateQueue({ maxRetries: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="field-label">Delay между запросами, мс</label>
        <input
          type="number"
          min={0}
          className="text-input"
          value={queue.delayMs}
          onChange={(e) => updateQueue({ delayMs: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="field-label">Timeout на запрос, мс</label>
        <input
          type="number"
          min={1000}
          className="text-input"
          value={queue.timeoutMs}
          onChange={(e) => updateQueue({ timeoutMs: Number(e.target.value) })}
        />
      </div>
      <div className="space-y-2 border-t border-slate-200 pt-3">
        <Checkbox
          label="Добавить ID3-теги (title, artist)"
          checked={settings.addId3Tags}
          onChange={(v) => onChange({ addId3Tags: v })}
        />
        <Checkbox
          label="Использовать кэш (не пересоздавать готовые файлы)"
          checked={settings.useCache}
          onChange={(v) => onChange({ useCache: v })}
        />
        <Checkbox
          label="Детальное логирование"
          checked={settings.verboseLogging}
          onChange={(v) => onChange({ verboseLogging: v })}
        />
      </div>
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300"
      />
      {label}
    </label>
  )
}
