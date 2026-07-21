// @vitest-environment jsdom
import '../../test/setupTestingLibrary'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParseErrorList } from './ParseErrorList'

describe('ParseErrorList', () => {
  it('показывает "готово к генерации", если ошибок и предупреждений нет', () => {
    render(<ParseErrorList errors={[]} warnings={[]} />)
    expect(screen.getByText(/готово к генерации/i)).toBeInTheDocument()
  })

  it('показывает ошибки с номерами строк', () => {
    render(
      <ParseErrorList
        errors={[
          { line: 45, message: 'Фраза без разделителя |' },
          { line: null, message: 'Не найден заголовок #TOPIC.' }
        ]}
        warnings={[]}
      />
    )
    expect(screen.getByText(/ошибки \(2\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Строка 45:/)).toBeInTheDocument()
    expect(screen.getByText(/Фраза без разделителя/)).toBeInTheDocument()
    expect(screen.getByText(/Не найден заголовок #TOPIC/)).toBeInTheDocument()
  })

  it('показывает предупреждения отдельно от ошибок', () => {
    render(
      <ParseErrorList
        errors={[]}
        warnings={[{ line: 12, message: 'Группа «llamarse» не содержит фраз и пропущена.' }]}
      />
    )
    expect(screen.getByText(/предупреждения \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/не содержит фраз/)).toBeInTheDocument()
    expect(screen.queryByText(/^ошибки/i)).not.toBeInTheDocument()
  })

  it('рендерит и ошибки, и предупреждения одновременно', () => {
    render(
      <ParseErrorList
        errors={[{ line: 3, message: 'Пустое название темы' }]}
        warnings={[{ line: 7, message: 'title_ru в YAML отличается от #TOPIC' }]}
      />
    )
    expect(screen.getByText(/ошибки \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/предупреждения \(1\)/i)).toBeInTheDocument()
  })
})
