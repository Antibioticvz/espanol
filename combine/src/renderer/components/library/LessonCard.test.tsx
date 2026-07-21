// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { LibraryScreen } from './LibraryScreen'

async function openFirstCardMenuAndClickDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const menuButtons = screen.getAllByRole('button', { name: '⋯ Ещё' })
  await user.click(menuButtons[0])
  const deleteItems = await screen.findAllByText('Удалить урок')
  await user.click(deleteItems[0])
}

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

/**
 * Мульти-верификаторное ревью (minor, LessonCard.tsx:102): «Удалить урок» раньше вызывала
 * deleteLesson.mutate() немедленно по клику — необратимое удаление lesson.json + ВСЕХ
 * сгенерированных (зачастую платных) mp3 без единого подтверждения. Теперь — window.confirm().
 */
describe('LessonCard — подтверждение перед удалением урока (мульти-верификаторное ревью, LessonCard.tsx:102)', () => {
  it('РЕГРЕССИЯ: отмена в confirm() -> deleteLesson НЕ вызывается, карточка остаётся', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      renderWithClient(<LibraryScreen onBack={() => {}} onGenerationStarted={() => {}} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: '⋯ Ещё' }).length).toBeGreaterThan(0)
      })
      const cardsBefore = screen.getAllByRole('button', { name: '⋯ Ещё' }).length

      await openFirstCardMenuAndClickDelete(user)

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      // Ни одна карточка не пропала — отменённое подтверждение не должно были дойти до mutate().
      expect(screen.getAllByRole('button', { name: '⋯ Ещё' }).length).toBe(cardsBefore)
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('РЕГРЕССИЯ: подтверждение в confirm() -> урок удаляется как раньше, карточка пропадает', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderWithClient(<LibraryScreen onBack={() => {}} onGenerationStarted={() => {}} />)

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: '⋯ Ещё' }).length).toBeGreaterThan(0)
      })
      const cardsBefore = screen.getAllByRole('button', { name: '⋯ Ещё' }).length

      await openFirstCardMenuAndClickDelete(user)

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: '⋯ Ещё' }).length).toBe(cardsBefore - 1)
      })
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
