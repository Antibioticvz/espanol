import type { ParserStats } from '../../../core/types/parsed-lesson'
import type { Provider } from '../../../core/types/lesson-json'
import { useEditableSettings } from '../../hooks/useSettings'
import { useVoicesQuery } from '../../hooks/useVoices'
import { useTestConnectionMutation } from '../../hooks/useTestConnection'
import { ApiKeyField } from './ApiKeyField'
import { VoiceSelect } from './VoiceSelect'
import { SynthesisSliders } from './SynthesisSliders'
import { QueueSettings } from './QueueSettings'
import { PriceTable } from './PriceTable'
import { CostCalculator } from './CostCalculator'
import { TestGenerationPanel } from './TestGenerationPanel'

export interface SettingsScreenProps {
  parseStats: ParserStats | null
  apiKey: string | null
  onApiKeyChange: (key: string | null) => void
  onBack: () => void
  onNext: () => void
}

const MODEL_OPTIONS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 ($0.10 / 1000 сим.)' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 ($0.05 / 1000 сим.)' }
]

/** Экран 2/4: настройки API ElevenLabs/mock и параметров генерации (см. docs/SPEC_COMBINE.md §4.2). */
export function SettingsScreen({ parseStats, apiKey, onApiKeyChange, onBack, onNext }: SettingsScreenProps): JSX.Element {
  const { settings, update, isLoading } = useEditableSettings()
  const testConnection = useTestConnectionMutation()
  const voicesQuery = useVoicesQuery(settings?.provider ?? 'mock_say', apiKey)

  if (isLoading || !settings) {
    return <div className="p-6 text-sm text-slate-500">Загрузка настроек…</div>
  }

  const voices = voicesQuery.data ?? []
  const esVoices = voices.filter((v) => v.labels?.language !== 'ru')
  const ruVoices = voices.filter((v) => v.labels?.language === 'ru')
  const isCustomModel = !MODEL_OPTIONS.some((m) => m.id === settings.model)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header>
        <p className="text-sm font-medium text-brand-600">Шаг 2 из 4</p>
        <h1 className="text-xl font-semibold text-slate-900">Настройки API и генерации</h1>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-900">ElevenLabs</h2>

          <div>
            <label className="field-label">Провайдер</label>
            <select
              className="text-input"
              value={settings.provider}
              onChange={(e) => update({ provider: e.target.value as Provider })}
            >
              <option value="mock_say">Mock (macOS say — бесплатно)</option>
              <option value="elevenlabs">ElevenLabs (реальный API)</option>
            </select>
          </div>

          {settings.provider === 'elevenlabs' && <ApiKeyField value={apiKey} onChange={onApiKeyChange} />}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => testConnection.mutate({ provider: settings.provider, apiKey })}
              disabled={testConnection.isPending}
            >
              {testConnection.isPending ? 'Проверка…' : 'Проверить подключение'}
            </button>
            {testConnection.data && (
              <span
                className={testConnection.data.ok ? 'text-sm font-medium text-green-700' : 'text-sm font-medium text-red-700'}
                data-testid="connection-status"
              >
                {testConnection.data.ok ? '✓' : '✗'} {testConnection.data.message}
              </span>
            )}
          </div>

          <div>
            <span className="field-label">Модель TTS</span>
            <div className="space-y-1">
              {MODEL_OPTIONS.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="model"
                    checked={settings.model === m.id}
                    onChange={() => update({ model: m.id })}
                  />
                  {m.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" name="model" checked={isCustomModel} onChange={() => update({ model: '' })} />
                Другая модель (ID):
                {isCustomModel && (
                  <input
                    type="text"
                    className="text-input"
                    value={settings.model}
                    onChange={(e) => update({ model: e.target.value })}
                  />
                )}
              </label>
            </div>
          </div>

          <VoiceSelect label="Голос испанский" voices={esVoices} value={settings.voiceEs} onChange={(v) => update({ voiceEs: v })} />
          <VoiceSelect label="Голос русский" voices={ruVoices} value={settings.voiceRu} onChange={(v) => update({ voiceRu: v })} />

          <SynthesisSliders
            stability={settings.stability}
            similarityBoost={settings.similarityBoost}
            seed={settings.seed}
            onChange={update}
          />

          <TestGenerationPanel
            provider={settings.provider}
            model={settings.model}
            apiKey={apiKey}
            voices={voices}
            defaultVoiceId={settings.voiceEs?.id}
            stability={settings.stability}
            similarityBoost={settings.similarityBoost}
          />
        </section>

        <section className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Параметры генерации</h2>
          <QueueSettings settings={settings} onChange={update} />
          <PriceTable pricing={settings.pricePerThousandChars} onChange={(pricePerThousandChars) => update({ pricePerThousandChars })} />
          {parseStats && (
            <CostCalculator
              model={settings.model}
              pricing={settings.pricePerThousandChars}
              charactersEs={parseStats.charactersEs}
              charactersRu={parseStats.charactersRu}
            />
          )}
        </section>
      </div>

      <div className="flex justify-between border-t border-slate-200 pt-4">
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Назад
        </button>
        <button type="button" className="btn-primary" onClick={onNext}>
          Генерировать →
        </button>
      </div>
    </div>
  )
}
