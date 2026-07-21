// @vitest-environment jsdom
import '../test/setupTestingLibrary'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ParsedLesson } from '../../core/types/parsed-lesson'
import { createDefaultSettings } from '../../core/types/settings'
import { api } from '../lib/api'
import { useGeneration } from './useGeneration'

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const PARSED_LESSON: ParsedLesson = {
  topicId: '09-reattach-test',
  topicNumber: 9,
  titleRu: 'Тест переподключения',
  titleEs: null,
  languageVariants: null,
  blocks: [
    {
      blockId: 'b1',
      type: 'vocabulary',
      titleRu: 'Слова',
      titleEs: null,
      orderIndex: 0,
      words: [{ id: '09-b1-vocab-01', es: 'el gato', ru: 'кот', sourceLine: 1 }]
    }
  ]
}

/**
 * Мульти-верификаторное ревью: закрытие/пересоздание окна во время генерации (macOS — main
 * продолжает работать в фоне) раньше "теряло" реально идущий (платный) прогон — новый монтаж
 * useGeneration() стартовал с topicId=null. Теперь хук спрашивает main о снимке активного прогона
 * при монтировании и переподключается (attach), см. shared/ipc.ts#getActiveGeneration.
 */
describe('useGeneration — переподключение к активному прогону при монтировании (мульти-верификаторное ревью)', () => {
  it('нет активной генерации -> хук остаётся в начальном состоянии (topicId=null)', async () => {
    const { result } = renderHook(() => useGeneration(), { wrapper })
    // Даём эффекту переподключения отработать (getActiveGeneration() резолвится в null).
    await waitFor(() => expect(result.current.topicId).toBeNull())
    expect(result.current.lesson).toBeNull()
    expect(result.current.progress).toBeNull()
  })

  it('генерация уже идёт (запущена "другим окном") -> новый монтаж хука подхватывает её сразу, без "не запущена"', async () => {
    const settings = createDefaultSettings('/mock/lessons')
    // Симулируем "main уже генерирует" — стартуем НАПРЯМУЮ через api, в обход этого хука, как будто
    // это сделало предыдущее (теперь закрытое) окно.
    await api.startGeneration({ lesson: PARSED_LESSON, settings, apiKey: null })

    // Монтируем "новый" экземпляр хука — как будто окно было закрыто и пересоздано.
    const { result } = renderHook(() => useGeneration(), { wrapper })

    await waitFor(() => {
      expect(result.current.topicId).toBe('09-reattach-test')
    })
    expect(result.current.lesson?.topic_id).toBe('09-reattach-test')
    // runState должен быть выставлен НЕМЕДЛЕННО из снимка (не ждать следующего live-события) —
    // именно это разблокирует Пауза/Отмена/Возобновить в UI (гейтятся на progress?.runState).
    expect(['running', 'paused']).toContain(result.current.progress?.runState)
    expect(result.current.isRunning || result.current.isPaused).toBe(true)
  })
})
