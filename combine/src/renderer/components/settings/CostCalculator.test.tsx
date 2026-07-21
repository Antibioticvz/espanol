// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithClient } from '../../test/renderWithClient'
import { CostCalculator } from './CostCalculator'

describe('CostCalculator (калькулятор стоимости, см. docs/SPEC_COMBINE.md §4.2)', () => {
  it('считает стоимость как totalChars/1000 * pricePerThousand (через mockAdapter.estimateCost)', async () => {
    renderWithClient(
      <CostCalculator
        model="eleven_multilingual_v2"
        pricing={{ eleven_multilingual_v2: 0.1 }}
        charactersEs={3737}
        charactersRu={3799}
      />
    )

    // 7536 символов * 0.10 / 1000 = 0.7536 -> $0.75 (formatUsd округляет до 2 знаков)
    await waitFor(() => {
      expect(screen.getByTestId('estimated-cost')).toHaveTextContent('$0.75')
    })
    // formatNumber использует ru-RU (разделитель разрядов — неразрывный пробел, не запятая)
    expect(screen.getByTestId('estimated-cost')).toHaveTextContent(/7\s*536/)
    expect(screen.getByText(/это оценка/i)).toBeInTheDocument()
  })

  it('стоимость нулевая для mock_say (бесплатный провайдер, D-04)', async () => {
    renderWithClient(<CostCalculator model="macos_say" pricing={{ macos_say: 0 }} charactersEs={100} charactersRu={100} />)
    await waitFor(() => {
      expect(screen.getByTestId('estimated-cost')).toHaveTextContent('$0.00')
    })
  })

  it('использует цену указанной модели, а не другую запись в таблице', async () => {
    renderWithClient(
      <CostCalculator
        model="eleven_flash_v2_5"
        pricing={{ eleven_multilingual_v2: 0.1, eleven_flash_v2_5: 0.05 }}
        charactersEs={1000}
        charactersRu={1000}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('estimated-cost')).toHaveTextContent('$0.10')
    })
  })
})
