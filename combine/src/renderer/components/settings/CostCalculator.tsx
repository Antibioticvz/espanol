import type { PricingTable } from '../../../core/types/settings'
import { useCostEstimate } from '../../hooks/useCostEstimate'
import { formatNumber, formatUsd } from '../../lib/format'

export interface CostCalculatorProps {
  model: string
  pricing: PricingTable
  charactersEs: number
  charactersRu: number
}

/** Калькулятор стоимости (см. docs/SPEC_COMBINE.md §4.2 "РАСЧЁТ СТОИМОСТИ"). */
export function CostCalculator({ model, pricing, charactersEs, charactersRu }: CostCalculatorProps): JSX.Element {
  const { data, isLoading } = useCostEstimate({
    model,
    pricePerThousandChars: pricing,
    charactersEs,
    charactersRu
  })

  return (
    <div className="card space-y-2" data-testid="cost-calculator">
      <h3 className="text-sm font-semibold text-slate-900">📊 Расчёт стоимости</h3>
      <dl className="space-y-1 text-sm text-slate-700">
        <div className="flex justify-between">
          <dt>Символов ES</dt>
          <dd className="tabular-nums">{formatNumber(charactersEs)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Символов RU</dt>
          <dd className="tabular-nums">{formatNumber(charactersRu)}</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Итого символов</dt>
          <dd className="tabular-nums">{formatNumber(charactersEs + charactersRu)}</dd>
        </div>
      </dl>
      {isLoading || !data ? (
        <p className="text-sm text-slate-400">Расчёт…</p>
      ) : (
        <>
          <p className="text-lg font-semibold text-slate-900" data-testid="estimated-cost">
            {formatNumber(data.totalCharacters)} × {formatUsd(data.pricePerThousand)} / 1000 = {formatUsd(data.estimatedCostUsd)}
          </p>
          <p className="text-xs text-amber-700">⚠ {data.note}</p>
        </>
      )}
    </div>
  )
}
