// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithClient } from '../../test/renderWithClient'
import { SettingsScreen } from './SettingsScreen'
import type { ParserStats } from '../../../core/types/parsed-lesson'

const stats: ParserStats = {
  blockCount: 4,
  phraseCount: 9,
  vocabCount: 4,
  storyCount: 1,
  totalElements: 14,
  charactersEs: 300,
  charactersRu: 320,
  totalCharacters: 620
}

describe('SettingsScreen (смоук, mockAdapter)', () => {
  it('загружает настройки и рендерит секции ElevenLabs / параметров генерации / калькулятора', async () => {
    renderWithClient(
      <SettingsScreen parseStats={stats} apiKey={null} onApiKeyChange={() => {}} onBack={() => {}} onNext={() => {}} />
    )

    expect(screen.getByText(/Загрузка настроек/)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Настройки API и генерации' })).toBeInTheDocument()
    })

    expect(screen.getByText('ElevenLabs')).toBeInTheDocument()
    expect(screen.getByText('Параметры генерации')).toBeInTheDocument()
    expect(screen.getByText('Тестовая генерация')).toBeInTheDocument()

    // Калькулятор стоимости должен появиться, т.к. parseStats передан
    await waitFor(() => {
      expect(screen.getByTestId('cost-calculator')).toBeInTheDocument()
    })
  })

  it('вызывает onNext при клике «Генерировать →»', async () => {
    const onNext = vi.fn()
    renderWithClient(
      <SettingsScreen parseStats={null} apiKey={null} onApiKeyChange={() => {}} onBack={() => {}} onNext={onNext} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Генерировать/ })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Генерировать/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
