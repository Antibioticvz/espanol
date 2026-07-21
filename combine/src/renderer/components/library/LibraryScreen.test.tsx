// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { LibraryScreen } from './LibraryScreen'

describe('LibraryScreen (смоук, mockAdapter)', () => {
  it('рендерит заголовок, карточки уроков (из mock-библиотеки) и общую статистику', async () => {
    renderWithClient(<LibraryScreen onBack={() => {}} onGenerationStarted={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Библиотека уроков' })).toBeInTheDocument()
    expect(screen.getByText(/Загрузка библиотеки/)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Рассказ о себе/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Первое свидание/)).toBeInTheDocument()
    expect(screen.getByText(/Готовка и кухня/)).toBeInTheDocument()

    expect(screen.getByTestId('library-stats-footer')).toBeInTheDocument()
  })

  it('фильтр «Готовые» скрывает урок в процессе', async () => {
    const user = userEvent.setup()
    renderWithClient(<LibraryScreen onBack={() => {}} onGenerationStarted={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/Готовка и кухня/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('radio', { name: 'Готовые' }))

    await waitFor(() => {
      expect(screen.queryByText(/Готовка и кухня/)).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Рассказ о себе/)).toBeInTheDocument()
  })
})
