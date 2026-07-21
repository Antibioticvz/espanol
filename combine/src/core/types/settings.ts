import type { Provider } from './lesson-json'
import type { QueueConfig } from './generation'

export interface VoiceSetting {
  id: string
  name: string
}

/** Цена за 1000 символов USD, ключ — model id (D-06: не хардкодим, редактируемо в UI). */
export type PricingTable = Record<string, number>

export const DEFAULT_PRICING: PricingTable = {
  eleven_multilingual_v2: 0.1,
  eleven_flash_v2_5: 0.05,
  macos_say: 0
}

export const DEFAULT_TEST_TEXT = 'Hola, ¿cómo estás?'

export interface AppSettings {
  provider: Provider
  model: string
  voiceEs: VoiceSetting | null
  voiceRu: VoiceSetting | null
  stability: number
  similarityBoost: number
  seed: number | null
  queue: QueueConfig
  outputDir: string
  addId3Tags: boolean
  useCache: boolean
  verboseLogging: boolean
  pricePerThousandChars: PricingTable
  /** D-05: текст для «Тестовой генерации» на экране настроек */
  testText: string
}

export function createDefaultSettings(outputDir: string): AppSettings {
  return {
    provider: 'mock_say',
    model: 'macos_say',
    voiceEs: { id: 'Mónica', name: 'Mónica' },
    voiceRu: { id: 'Milena', name: 'Milena' },
    stability: 0.5,
    similarityBoost: 0.75,
    seed: null,
    queue: { concurrency: 3, maxRetries: 3, delayMs: 100, timeoutMs: 30000 },
    outputDir,
    addId3Tags: true,
    useCache: true,
    verboseLogging: false,
    pricePerThousandChars: { ...DEFAULT_PRICING },
    testText: DEFAULT_TEST_TEXT
  }
}
