// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithClient } from '../../test/renderWithClient'
import { GenerationScreen } from './GenerationScreen'
import { useGeneration } from '../../hooks/useGeneration'
import { createDefaultSettings } from '../../../core/types/settings'
import type { ParsedLesson } from '../../../core/types/parsed-lesson'

const fixtureLesson: ParsedLesson = {
  topicId: '99-test',
  topicNumber: 99,
  titleRu: 'Тестовая тема',
  titleEs: null,
  languageVariants: null,
  blocks: [
    {
      blockId: 'b1',
      type: 'verb_group',
      titleRu: 'Блок',
      titleEs: null,
      orderIndex: 0,
      groups: [
        {
          key: 'test',
          titleRu: null,
          translationRu: 'тест',
          orderIndex: 0,
          phrases: [{ id: '99-b1-test-01', es: 'Hola.', ru: 'Привет.', sourceLine: 1 }]
        }
      ]
    }
  ]
}

/** Тестовый харнесс: GenerationScreen — «глупый» компонент, стейт приходит из useGeneration(). */
function Harness(): JSX.Element {
  const generation = useGeneration()
  return (
    <div>
      <button type="button" onClick={() => generation.start({ lesson: fixtureLesson, settings: createDefaultSettings('/tmp/test'), apiKey: null })}>
        __start_for_test__
      </button>
      <GenerationScreen generation={generation} onBack={() => {}} onOpenLibrary={() => {}} />
    </div>
  )
}

describe('GenerationScreen (смоук, mockAdapter)', () => {
  it('показывает заглушку, пока генерация не запущена', () => {
    renderWithClient(<Harness />)
    expect(screen.getByRole('heading', { name: 'Генерация' })).toBeInTheDocument()
    expect(screen.getByText(/ещё не запущена/)).toBeInTheDocument()
  })

  it('после запуска показывает прогресс, дерево блоков и кнопки управления', async () => {
    const user = userEvent.setup()
    renderWithClient(<Harness />)

    await user.click(screen.getByText('__start_for_test__'))

    await waitFor(() => {
      expect(screen.getByText('Генерация: Тестовая тема')).toBeInTheDocument()
    })

    expect(screen.getByTestId('block-tree')).toBeInTheDocument()
    expect(screen.getByTestId('live-log')).toBeInTheDocument()
    expect(screen.getByTestId('overall-progress-label')).toBeInTheDocument()

    // Останавливаем фоновые таймеры мока, чтобы не оставлять висящий setTimeout после теста.
    await user.click(screen.getByRole('button', { name: /Отмена/ }))
    await waitFor(() => {
      expect(screen.getByText(/Отменено/)).toBeInTheDocument()
    })
  })
})
