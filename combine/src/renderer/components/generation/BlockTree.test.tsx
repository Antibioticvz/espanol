// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockTree } from './BlockTree'
import type { TreeBlock } from '../../lib/lessonTree'

const fixture: TreeBlock[] = [
  {
    blockId: 'b1',
    type: 'verb_group',
    title: 'Кто я',
    groups: [
      {
        key: 'llamarse',
        title: 'зваться',
        phrases: [
          { id: '04-b1-llamarse-01', es: 'Me llamo Victor.', ru: 'Меня зовут Виктор.', status: 'done', durationMs: 1200 },
          { id: '04-b1-llamarse-02', es: '¿Cómo te llamas tú?', ru: 'Как тебя зовут?', status: 'generating' },
          {
            id: '04-b1-llamarse-03',
            es: 'Todos me llaman Vic.',
            ru: 'Все зовут меня Вик.',
            status: 'failed',
            error: '429 Too Many Requests'
          },
          { id: '04-b1-llamarse-04', es: 'Pendiente.', ru: 'В очереди.', status: 'pending' }
        ]
      }
    ]
  },
  {
    blockId: 'b2',
    type: 'vocabulary',
    title: 'Ключевая лексика',
    words: [{ id: '04-b2-vocab-01', es: 'el programador', ru: 'программист', status: 'done', durationMs: 800 }]
  }
]

describe('BlockTree (прогресс-дерево, см. docs/SPEC_COMBINE.md §4.3)', () => {
  it('показывает статусы ✓ ⏱ ⚠ ◯ для фраз', () => {
    render(<BlockTree blocks={fixture} />)
    const done = screen.getByTestId('phrase-04-b1-llamarse-01')
    const generating = screen.getByTestId('phrase-04-b1-llamarse-02')
    const failed = screen.getByTestId('phrase-04-b1-llamarse-03')
    const pending = screen.getByTestId('phrase-04-b1-llamarse-04')

    expect(done).toHaveTextContent('✓')
    expect(generating).toHaveTextContent('⏱')
    expect(failed).toHaveTextContent('⚠')
    expect(pending).toHaveTextContent('◯')
    expect(failed).toHaveTextContent('429 Too Many Requests')
  })

  it('показывает заголовки блоков/групп со счётчиками', () => {
    render(<BlockTree blocks={fixture} />)
    expect(screen.getByText(/Кто я \(4\)/)).toBeInTheDocument()
    expect(screen.getByText(/зваться \(4\)/)).toBeInTheDocument()
    expect(screen.getByText(/Ключевая лексика \(1\)/)).toBeInTheDocument()
  })

  it('сворачивает и разворачивает блок по клику на заголовок', async () => {
    const user = userEvent.setup()
    render(<BlockTree blocks={fixture} />)

    expect(screen.getByTestId('phrase-04-b1-llamarse-01')).toBeInTheDocument()

    await user.click(screen.getByText(/BLOCK: Глаголы — Кто я/))
    expect(screen.queryByTestId('phrase-04-b1-llamarse-01')).not.toBeInTheDocument()

    await user.click(screen.getByText(/BLOCK: Глаголы — Кто я/))
    expect(screen.getByTestId('phrase-04-b1-llamarse-01')).toBeInTheDocument()
  })

  it('рендерит пустое дерево без ошибок', () => {
    render(<BlockTree blocks={[]} />)
    expect(screen.getByText(/нет данных/i)).toBeInTheDocument()
  })
})
