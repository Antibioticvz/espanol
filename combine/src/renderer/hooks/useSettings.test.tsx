// @vitest-environment jsdom
import '../test/setupTestingLibrary'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useEditableSettings } from './useSettings'

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Мульти-верификаторное ревью (minor, useSettings.ts:40): раньше update() слал
 * saveMutation.mutate() (реальный IPC combine:settings:save -> запись settings.json) НА КАЖДЫЙ
 * вызов — каждое нажатие клавиши/тик слайдера. Теперь фактическое сохранение дебаунсится, а
 * локальное состояние (то, что видит UI) обновляется по-прежнему немедленно.
 */
describe('useEditableSettings — дебаунс автосохранения (мульти-верификаторное ревью, useSettings.ts:40)', () => {
  it('несколько быстрых update() подряд -> ОДИН api.saveSettings() с финальным значением (не по одному на вызов)', async () => {
    const spy = vi.spyOn(api, 'saveSettings')
    const { result } = renderHook(() => useEditableSettings(30), { wrapper })

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    spy.mockClear() // на случай вызовов от общего mockAdapter-состояния до этого теста

    act(() => {
      result.current.update({ model: 'rapid-1' })
      result.current.update({ model: 'rapid-2' })
      result.current.update({ model: 'rapid-3' })
    })

    // Локальное состояние (то, что видит и на что реагирует UI) обновляется НЕМЕДЛЕННО —
    // отзывчивость полей/слайдеров не страдает от дебаунса самого сохранения.
    expect(result.current.settings?.model).toBe('rapid-3')
    // Но фактическое сохранение ещё не улетело — ждём паузы (дебаунс).
    expect(spy).not.toHaveBeenCalled()

    // РЕГРЕССИЯ: без дебаунса spy был бы вызван 3 раза подряд (rapid-1, rapid-2, rapid-3).
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ model: 'rapid-3' }))

    spy.mockRestore()
  })

  it('размонтирование ДО истечения дебаунса -> отложенное изменение всё равно сохраняется (flush при unmount)', async () => {
    const spy = vi.spyOn(api, 'saveSettings')
    // Намеренно огромная задержка — гарантирует, что дебаунс НЕ успеет сработать сам по себе
    // до unmount(), так что единственный способ увидеть вызов ниже — это flush в cleanup-эффекте.
    const { result, unmount } = renderHook(() => useEditableSettings(5000), { wrapper })

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    spy.mockClear()

    act(() => {
      result.current.update({ model: 'flush-on-unmount' })
    })
    expect(spy).not.toHaveBeenCalled()

    unmount()

    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ model: 'flush-on-unmount' })))

    spy.mockRestore()
  })

  it('размонтирование БЕЗ несохранённых изменений -> flush не вызывает api.saveSettings лишний раз', async () => {
    const spy = vi.spyOn(api, 'saveSettings')
    const { result, unmount } = renderHook(() => useEditableSettings(30), { wrapper })

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    spy.mockClear()

    unmount() // ничего не менялось — pendingRef пуст, flush не должен ничего слать

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
