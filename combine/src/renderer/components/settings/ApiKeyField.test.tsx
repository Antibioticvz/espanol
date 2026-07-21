// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { ApiKeyField } from './ApiKeyField'

/** Симулирует App.tsx: value/onChange живут в состоянии родителя, ApiKeyField — контролируемый. */
function Wrapper(): JSX.Element {
  const [value, setValue] = useState<string | null>(null)
  return <ApiKeyField value={value} onChange={setValue} />
}

/**
 * v1.2 (D-23): персистентность ключа через mockAdapter (localStorage, см. renderer/adapters/
 * mockAdapter.ts) — ключ никогда не читается обратно из статуса, только "сохранён"/"не сохранён".
 */
describe('ApiKeyField — сохранение/статус/удаление ключа (v1.2, D-23, mockAdapter)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('нет сохранённого ключа -> показывает поле ввода и подсказку про автоматическое использование', async () => {
    renderWithClient(<Wrapper />)

    await waitFor(() => {
      expect(screen.getByLabelText('API-ключ ElevenLabs')).toBeInTheDocument()
    })
    expect(screen.getByText(/используется автоматически/)).toBeInTheDocument()
    expect(screen.queryByTestId('api-key-saved-badge')).not.toBeInTheDocument()
  })

  it('ввод + «Сохранить» -> ключ персистится, статус переключается на «сохранён», локальное value очищается', async () => {
    const user = userEvent.setup()
    renderWithClient(<Wrapper />)

    await waitFor(() => {
      expect(screen.getByLabelText('API-ключ ElevenLabs')).toBeInTheDocument()
    })
    await user.type(screen.getByLabelText('API-ключ ElevenLabs'), 'sk-test-123')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => {
      expect(screen.getByTestId('api-key-saved-badge')).toBeInTheDocument()
    })
    // Значение НЕ отображается нигде на экране (только маска) и локальное состояние родителя сброшено —
    // поле ввода с сырым ключом исчезает целиком, остаётся только бейдж статуса.
    expect(screen.queryByLabelText('API-ключ ElevenLabs')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('sk-test-123')).not.toBeInTheDocument()
    expect(localStorage.getItem('combine:mock:apiKey')).toBe('sk-test-123')
  })

  it('«Удалить ключ» -> статус возвращается к «не задан», снова показывается поле ввода', async () => {
    localStorage.setItem('combine:mock:apiKey', 'sk-existing')
    const user = userEvent.setup()
    renderWithClient(<Wrapper />)

    await waitFor(() => {
      expect(screen.getByTestId('api-key-saved-badge')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('delete-api-key'))

    await waitFor(() => {
      expect(screen.getByLabelText('API-ключ ElevenLabs')).toBeInTheDocument()
    })
    expect(localStorage.getItem('combine:mock:apiKey')).toBeNull()
  })

  it('уже сохранённый ключ при монтировании -> сразу показывает бейдж «сохранён» (без ввода)', async () => {
    localStorage.setItem('combine:mock:apiKey', 'sk-preexisting')
    renderWithClient(<Wrapper />)

    await waitFor(() => {
      expect(screen.getByTestId('api-key-saved-badge')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('API-ключ ElevenLabs')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument()
  })
})
