// @vitest-environment jsdom
import '../test/setupTestingLibrary'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useVoicesQuery } from './useVoices'

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Мульти-верификаторное ревью (minor, useVoices.ts:7): раньше apiKey был частью queryKey БЕЗ
 * дебаунса — посимвольный ввод ключа ElevenLabs (см. components/settings/ApiKeyField.tsx) слал
 * настоящий GET /v1/voices на каждое нажатие клавиши. Плюс сырой ключ оседал в queryKey (виден в
 * React Query Devtools/памяти кэша) вместо хэша.
 */
describe('useVoicesQuery — дебаунс apiKey + хэш вместо сырого ключа в queryKey (мульти-верификаторное ревью)', () => {
  it('быстрый посимвольный ввод -> ОДИН вызов api.listVoices с финальным значением, а не по одному на символ', async () => {
    const spy = vi.spyOn(api, 'listVoices')
    const { rerender } = renderHook(({ apiKey }: { apiKey: string | null }) => useVoicesQuery('elevenlabs', apiKey, 30), {
      wrapper,
      initialProps: { apiKey: null as string | null }
    })

    // Немедленный вызов при монтировании (apiKey=null -> main использует сохранённый ключ,
    // см. docstring useVoices.ts) — не то, что тестируется здесь, сбрасываем счётчик.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    spy.mockClear()

    // Симулируем быстрый посимвольный ввод "sk-123" — 6 keystroke'ов подряд, без пауз.
    for (const partial of ['s', 'sk', 'sk-', 'sk-1', 'sk-12', 'sk-123']) {
      rerender({ apiKey: partial })
    }

    // РЕГРЕССИЯ: без дебаунса spy был бы вызван 6 раз (по одному на промежуточный символ),
    // каждый раз с заведомо неполным (гарантированно 401 на реальном API) ключом.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy).toHaveBeenCalledWith({ provider: 'elevenlabs', apiKey: 'sk-123' })

    spy.mockRestore()
  })

  it('queryKey НЕ содержит сырой apiKey (только хэш) — секрет не оседает в кэше React Query', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const localWrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const SECRET = 'sk-super-secret-key-should-not-leak-into-cache'
    renderHook(() => useVoicesQuery('elevenlabs', SECRET, 5), { wrapper: localWrapper })

    await waitFor(() => expect(client.getQueryCache().getAll().length).toBeGreaterThan(0))
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey))
    for (const k of keys) {
      expect(k).not.toContain(SECRET)
    }
  })

  it('разные ключи дают разные записи в кэше (хэш не схлопывает их в одну — переход между ключами не путает голоса)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const localWrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { rerender } = renderHook(({ apiKey }: { apiKey: string }) => useVoicesQuery('elevenlabs', apiKey, 5), {
      wrapper: localWrapper,
      initialProps: { apiKey: 'key-one' }
    })
    await waitFor(() => expect(client.getQueryCache().getAll().length).toBe(1))

    rerender({ apiKey: 'key-two' })
    await waitFor(() => expect(client.getQueryCache().getAll().length).toBe(2))
  })
})
