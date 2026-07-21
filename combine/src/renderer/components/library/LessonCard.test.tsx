// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { LibraryScreen } from './LibraryScreen'

/** Пункт меню карточки «Экспорт в Anki» (v1.1, docs/DECISIONS.md) — см. useLibraryActions#exportAnki
 * и mockAdapter.ts#exportAnki (dev:web не может писать реальный .apkg, но контракт тот же). */
describe('LessonCard — пункт меню «Экспорт в Anki» (смоук, mockAdapter)', () => {
  it('открывает меню карточки, кликает «Экспорт в Anki», меню закрывается без падения', async () => {
    const user = userEvent.setup()
    renderWithClient(<LibraryScreen onBack={() => {}} onGenerationStarted={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/Рассказ о себе/)).toBeInTheDocument()
    })

    const menuButtons = screen.getAllByRole('button', { name: '⋯ Ещё' })
    await user.click(menuButtons[0])

    const ankiItems = await screen.findAllByText('Экспорт в Anki')
    expect(ankiItems.length).toBeGreaterThan(0)
    await user.click(ankiItems[0])

    // Меню закрывается сразу по клику (setMenuOpen(false) в onClick) — мутация уходит в mockAdapter в фоне.
    await waitFor(() => {
      expect(screen.queryByText('Экспорт в Anki')).not.toBeInTheDocument()
    })
  })
})
