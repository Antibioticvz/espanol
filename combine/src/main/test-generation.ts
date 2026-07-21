import { MockSayService } from '../core/tts/mock-say.service'
import { ElevenLabsService } from '../core/tts/eleven-labs.service'
import { CostCalculator } from '../core/cost/cost-calculator'
import type { Provider } from '../core/types/lesson-json'
import type { Lang } from '../core/types/generation'
import type { PricingTable } from '../core/types/settings'
import { getAppContext } from './services-bootstrap'

export interface TestGenerationParams {
  text: string
  lang: Lang
  provider: Provider
  model: string
  voiceId: string
  stability?: number | null
  similarityBoost?: number | null
  seed?: number | null
  pricePerThousandChars: PricingTable
  /**
   * Явный ключ ElevenLabs (см. src/shared/ipc.ts#TestSnippetInput) — используется, если непустой;
   * иначе (не передан/пустой) — как раньше, читается из secure storage через requireApiKey().
   * Опционален и обратносовместим: вложенный `window.combine` (combine:test-generate) его не шлёт.
   */
  apiKey?: string | null
}

export interface TestGenerationResult {
  audioBase64: string
  durationMs: number
  characters: number
  costUsd: number
}

/**
 * D-05 (ключевое требование пользователя): «Тестовая генерация» на экране настроек — один
 * TTS-запрос вне очереди/lesson.json, для проверки ключа/голоса/кода перед дорогой генерацией
 * целой темы. Работает и с mock_say (бесплатно), и с elevenlabs (реальная стоимость ~$0.003).
 */
export async function runTestGeneration(params: TestGenerationParams): Promise<TestGenerationResult> {
  const provider =
    params.provider === 'mock_say'
      ? new MockSayService()
      : new ElevenLabsService({ apiKey: await resolveApiKey(params.apiKey), maxRetries: 1 })

  const result = await provider.synthesize({
    text: params.text,
    lang: params.lang,
    voiceId: params.voiceId,
    modelId: params.model,
    stability: params.stability,
    similarityBoost: params.similarityBoost,
    seed: params.seed
  })

  const costCalculator = new CostCalculator(params.pricePerThousandChars)
  const costUsd = costCalculator.actualFromCharacters(result.characters, params.model)

  return {
    audioBase64: result.audio.toString('base64'),
    durationMs: result.durationMs,
    characters: result.characters,
    costUsd
  }
}

async function resolveApiKey(explicit?: string | null): Promise<string> {
  if (explicit && explicit.trim().length > 0) return explicit
  const apiKey = await getAppContext().settingsService.getApiKey()
  if (!apiKey) throw new Error('API-ключ ElevenLabs не задан — откройте настройки и введите ключ.')
  return apiKey
}
