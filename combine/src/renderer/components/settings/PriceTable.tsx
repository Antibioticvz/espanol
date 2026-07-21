import type { PricingTable } from '../../../core/types/settings'

export interface PriceTableProps {
  pricing: PricingTable
  onChange: (pricing: PricingTable) => void
}

const MODEL_LABELS: Record<string, string> = {
  eleven_multilingual_v2: 'Multilingual v2',
  eleven_flash_v2_5: 'Flash v2.5',
  macos_say: 'macOS say (mock)'
}

/** Редактируемая таблица цен за 1000 символов — цены не хардкодим (docs/DECISIONS.md D-06). */
export function PriceTable({ pricing, onChange }: PriceTableProps): JSX.Element {
  const entries = Object.entries(pricing)

  return (
    <div>
      <h4 className="field-label">Цены за 1000 символов, $ (редактируемо)</h4>
      <table className="w-full text-sm" data-testid="price-table">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pb-1 font-normal">Модель</th>
            <th className="pb-1 font-normal">Цена, $/1000 сим.</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([model, price]) => (
            <tr key={model}>
              <td className="py-1 pr-2 text-slate-700">{MODEL_LABELS[model] ?? model}</td>
              <td className="py-1">
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  aria-label={`Цена для ${MODEL_LABELS[model] ?? model}`}
                  className="text-input"
                  value={price}
                  onChange={(e) => onChange({ ...pricing, [model]: Number(e.target.value) })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
