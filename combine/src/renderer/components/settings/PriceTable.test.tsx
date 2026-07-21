// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PriceTable } from './PriceTable'

describe('PriceTable (D-06: редактируемые цены)', () => {
  it('рендерит строку на каждую модель из таблицы цен', () => {
    render(<PriceTable pricing={{ eleven_multilingual_v2: 0.1, eleven_flash_v2_5: 0.05 }} onChange={() => {}} />)
    expect(screen.getByText('Multilingual v2')).toBeInTheDocument()
    expect(screen.getByText('Flash v2.5')).toBeInTheDocument()
    expect(screen.getByLabelText(/Цена для Multilingual v2/i)).toHaveValue(0.1)
  })

  it('вызывает onChange с обновлённой таблицей при правке цены', () => {
    // PriceTable — контролируемый компонент: пропс `pricing` в этом тесте не обновляется в ответ на
    // onChange (onChange — заглушка), поэтому value инпута не меняется между кликами. Проверяем прямой
    // set значения (fireEvent.change), а не посимвольный ввод (user.type "плывёт" по неизменному value).
    const onChange = vi.fn()
    render(<PriceTable pricing={{ eleven_multilingual_v2: 0.1 }} onChange={onChange} />)

    const input = screen.getByLabelText(/Цена для Multilingual v2/i)
    fireEvent.change(input, { target: { value: '0.2' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ eleven_multilingual_v2: 0.2 })
  })
})
