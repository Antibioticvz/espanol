import { describe, expect, it } from 'vitest'
import { CostCalculator } from './cost-calculator'

const PRICING = { eleven_multilingual_v2: 0.1, eleven_flash_v2_5: 0.05, macos_say: 0 }

describe('CostCalculator', () => {
  it('estimate() считает totalCharacters * price / 1000 и помечает isEstimate=true', () => {
    const calc = new CostCalculator(PRICING)
    const result = calc.estimate(3737, 3799, 'eleven_multilingual_v2')
    expect(result.totalCharacters).toBe(7536)
    expect(result.pricePerThousandChars).toBe(0.1)
    expect(result.costUsd).toBeCloseTo(0.7536, 4)
    expect(result.isEstimate).toBe(true)
  })

  it('использует правильную цену по модели (flash дешевле multilingual)', () => {
    const calc = new CostCalculator(PRICING)
    const multi = calc.estimate(1000, 1000, 'eleven_multilingual_v2')
    const flash = calc.estimate(1000, 1000, 'eleven_flash_v2_5')
    expect(multi.costUsd).toBeGreaterThan(flash.costUsd)
    expect(flash.costUsd).toBeCloseTo(0.1, 4) // 2000 симв. * 0.05/1000
  })

  it('mock_say (macos_say) стоит 0 — бесплатный dev-режим', () => {
    const calc = new CostCalculator(PRICING)
    const result = calc.estimate(50000, 50000, 'macos_say')
    expect(result.costUsd).toBe(0)
  })

  it('неизвестная модель без цены в таблице считается по цене 0, а не падает', () => {
    const calc = new CostCalculator(PRICING)
    const result = calc.estimate(1000, 1000, 'unknown_model_xyz')
    expect(result.costUsd).toBe(0)
    expect(result.pricePerThousandChars).toBe(0)
  })

  it('actualFromCharacters() считает фактическую стоимость по реальным символам', () => {
    const calc = new CostCalculator(PRICING)
    expect(calc.actualFromCharacters(7500, 'eleven_multilingual_v2')).toBeCloseTo(0.75, 4)
  })

  it('редактируемая таблица цен (D-06) — конструктор принимает произвольные значения', () => {
    const custom = new CostCalculator({ eleven_multilingual_v2: 0.25 })
    expect(custom.priceForModel('eleven_multilingual_v2')).toBe(0.25)
    expect(custom.estimate(1000, 0, 'eleven_multilingual_v2').costUsd).toBeCloseTo(0.25, 4)
  })
})
