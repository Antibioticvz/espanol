import type { AppSettings } from '../../../core/types/settings'
import { useFfmpegAvailableQuery } from '../../hooks/useFfmpeg'

export interface QueueSettingsProps {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}

/** Папка вывода + параметры очереди генерации (см. docs/SPEC_COMBINE.md §4.2, правая панель). */
export function QueueSettings({ settings, onChange }: QueueSettingsProps): JSX.Element {
  const { queue } = settings
  const updateQueue = (patch: Partial<AppSettings['queue']>): void => onChange({ queue: { ...queue, ...patch } })

  // v1.2 (D-23): для mock_say нормализация всегда успешна (чистый JS) — предупреждение о ffmpeg
  // актуально только когда provider=elevenlabs И настройка включена (иначе ffmpeg не понадобится).
  const ffmpegRelevant = settings.provider === 'elevenlabs' && settings.normalizeAudio
  const ffmpegQuery = useFfmpegAvailableQuery(ffmpegRelevant)

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
        <Checkbox
          label="Нормализация громкости фраз"
          checked={settings.normalizeAudio}
          onChange={(v) => onChange({ normalizeAudio: v })}
        />
        {ffmpegRelevant && ffmpegQuery.data === false && (
          <p className="field-hint text-amber-600" data-testid="ffmpeg-unavailable-hint">
            Нормализация недоступна: установите ffmpeg (напр. <code>brew install ffmpeg</code>) — без него фразы
            ElevenLabs сохраняются без изменения громкости. mock_say нормализуется всегда (не требует ffmpeg).
          </p>
        )}
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
