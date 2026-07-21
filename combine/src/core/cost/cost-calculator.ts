import type { PricingTable } from '../types/settings'

export interface CostEstimate {
  totalCharacters: number
  pricePerThousandChars: number
  costUsd: number
  /** Всегда true — оценка стоимости не гарантирована (D-06: ElevenLabs считает символы чуть иначе). */
  isEstimate: true
}

function roundCost(n: number): number {
  return Math.round(n * 10000) / 10000
}

/**
 * CostCalculator — оценка стоимости из символов × цена модели (docs/DECISIONS.md D-06: цены
 * НЕ хардкодятся, берутся из редактируемой в настройках PricingTable с дефолтами по документации).
 * Результат estimate() всегда помечен isEstimate=true — UI обязан показывать это как оценку,
 * фактическая стоимость (actualFromCharacters) уточняется после реальной генерации по числу
 * реально озвученных символов, которые вернул провайдер.
 */
export class CostCalculator {
  constructor(private readonly pricing: PricingTable) {}

  priceForModel(modelId: string): number {
    return this.pricing[modelId] ?? 0
  }

  estimate(charactersEs: number, charactersRu: number, modelId: string): CostEstimate {
    const totalCharacters = charactersEs + charactersRu
    const pricePerThousandChars = this.priceForModel(modelId)
    return {
      totalCharacters,
      pricePerThousandChars,
      costUsd: roundCost((totalCharacters / 1000) * pricePerThousandChars),
      isEstimate: true
    }
  }

  /** Стоимость по фактически подсчитанным символам (напр. сумма task.esCharacters/ruCharacters). */
  actualFromCharacters(totalCharacters: number, modelId: string): number {
    return roundCost((totalCharacters / 1000) * this.priceForModel(modelId))
  }
}
