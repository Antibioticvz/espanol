import type { Provider } from '../../../core/types/lesson-json'
import type { VoiceOption } from '../../../shared/ipc'
import { createBeepDataUrl } from './beep-audio'

/**
 * Голоса для mock-провайдеров. Список зависит от provider (см. voicesForProvider ниже) — иначе
 * dropdown'ы показывали бы ElevenLabs-имена (Pablo/Masha) даже при выбранном mock_say, а дефолтные
 * настройки (core/types/settings.ts#createDefaultSettings, core/tts/say-voices.ts) используют РЕАЛЬНЫЕ
 * имена голосов macOS say (Mónica/Milena, D-04) — рассинхрон был бы заметен в UI (VoiceSelect молча
 * подставлял бы первый голос из чужого списка вместо реально выбранного).
 *
 * Имена/языки ElevenLabs-варианта — вымышленные плейсхолдеры (см. docs/DECISIONS.md D-02: реальные
 * voice_id непрозрачны и грузятся через GET /v1/voices). `labels.language` — соглашение ТОЛЬКО для
 * мока, чтобы UI мог фильтровать список на ES/RU dropdown'ы.
 */
function voice(id: string, name: string, language: 'es' | 'ru', accent: string, freqHz: number): VoiceOption {
  return {
    id,
    name,
    previewUrl: createBeepDataUrl({ freqHz, durationMs: 900 }),
    category: 'mock',
    labels: { language, accent }
  }
}

/** Голоса macOS `say` по умолчанию (см. CLAUDE.md, docs/DECISIONS.md D-04) — id совпадает с именем. */
export const MOCK_SAY_VOICES: VoiceOption[] = [voice('Mónica', 'Mónica', 'es', 'es_ES', 220), voice('Milena', 'Milena', 'ru', 'ru_RU', 294)]

export const ELEVENLABS_MOCK_VOICES: VoiceOption[] = [
  voice('mock-es-pablo', 'Pablo', 'es', 'es-MX', 233),
  voice('mock-es-diego', 'Diego', 'es', 'es-MX', 247),
  voice('mock-es-maria', 'Maria', 'es', 'es-ES', 262),
  voice('mock-es-sofia', 'Sofia', 'es', 'es-ES', 277),
  voice('mock-ru-masha', 'Masha', 'ru', 'ru-RU', 311),
  voice('mock-ru-sasha', 'Sasha', 'ru', 'ru-RU', 330),
  voice('mock-ru-natasha', 'Natasha', 'ru', 'ru-RU', 349),
  voice('mock-ru-aleksandr', 'Aleksandr', 'ru', 'ru-RU', 370)
]

/** Полный список — используется там, где провайдер ещё не важен (напр. тестовая генерация по id). */
export const MOCK_VOICES: VoiceOption[] = [...MOCK_SAY_VOICES, ...ELEVENLABS_MOCK_VOICES]

export function voicesForProvider(provider: Provider): VoiceOption[] {
  return provider === 'elevenlabs' ? ELEVENLABS_MOCK_VOICES : MOCK_SAY_VOICES
}

export function voiceLanguage(v: VoiceOption): 'es' | 'ru' | null {
  const lang = v.labels?.language
  return lang === 'es' || lang === 'ru' ? lang : null
}
