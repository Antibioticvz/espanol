// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { ImportScreen } from './ImportScreen'

describe('ImportScreen (смоук, mockAdapter)', () => {
  it('рендерит заголовок и кнопку «Далее →» отключена без текста', () => {
    renderWithClient(<ImportScreen onNext={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Импорт урока' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled()
  })

  it('живой парсинг: «Вставить пример» показывает статистику и включает «Далее →»', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    renderWithClient(<ImportScreen onNext={onNext} />)

    await user.click(screen.getByRole('button', { name: /Вставить пример/ }))

    await waitFor(
      () => {
        expect(screen.getByText(/Ошибок: 0/)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    expect(screen.getByRole('button', { name: /Далее/ })).toBeEnabled()
    expect(screen.getByText(/Готово к генерации/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Далее/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
    const [lesson, stats] = onNext.mock.calls[0]
    expect(lesson.titleRu).toBe('Готовка и кухня')
    expect(stats.phraseCount).toBeGreaterThan(0)
  })

  it('показывает ошибки парсинга для некорректного текста', async () => {
    const user = userEvent.setup()
    renderWithClient(<ImportScreen onNext={() => {}} />)

    const textarea = screen.getByLabelText('Текст урока')
    await user.type(textarea, 'это не похоже на формат урока')

    await waitFor(
      () => {
        expect(screen.getByText(/Не найден заголовок #TOPIC/)).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /Далее/ })).toBeDisabled()
  })
})
