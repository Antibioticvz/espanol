import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '../../core/types/settings'
import { api } from '../lib/api'

export const SETTINGS_QUERY_KEY = ['settings'] as const
const DEFAULT_SAVE_DELAY_MS = 400

export function useSettingsQuery() {
  return useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => api.getSettings() })
}

export function useSaveSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: AppSettings) => api.saveSettings(settings),
    onSuccess: (_data, settings) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, settings)
    }
  })
}

/**
 * Локальный "черновик" настроек с авто-сохранением на каждое изменение — упрощает экран настроек
 * (без отдельной кнопки "Сохранить", правки применяются сразу же, как в большинстве нативных приложений).
 *
 * Мульти-верификаторное ревью (minor, useSettings.ts:40): раньше update() слал saveMutation.mutate()
 * НА КАЖДЫЙ вызов — каждое нажатие клавиши в текстовом поле, каждый тик слайдера (stability/
 * similarity_boost/seed, см. SynthesisSliders) уходил отдельным IPC-вызовом combine:settings:save,
 * т.е. отдельной записью settings.json на диск main-процессом. При перетаскивании слайдера — десятки
 * записей в секунду. Теперь: `local` (то, что видит и на что реагирует UI) обновляется НЕМЕДЛЕННО,
 * как и раньше — поля/слайдеры остаются отзывчивыми, — а фактический saveMutation.mutate() дебаунсится
 * (по умолчанию 400мс простоя). Несохранённое изменение НЕ теряется при размонтировании экрана
 * (напр. быстрый переход «Назад»/«Генерировать →» сразу после правки, до истечения дебаунса) —
 * при unmount отложенное значение досылается немедленно напрямую через api.saveSettings (в обход
 * самой мутации — компонент уже размонтирован, обновлять его React-состояние незачем и небезопасно),
 * плюс кэш React Query обновляется вручную, чтобы другие подписчики (см. App.tsx#useSettingsQuery)
 * не остались с устаревшими данными. Ограничение: аварийное закрытие ВСЕГО окна/процесса ровно
 * внутри окна дебаунса (400мс после последней правки) по-прежнему теряет самое последнее изменение —
 * React unmount-эффект не может перехватить закрытие процесса; это осознанный, ограниченный по
 * времени компромисс дебаунса, а не регрессия относительно упомянутого в ревью решения.
 */
export function useEditableSettings(saveDelayMs = DEFAULT_SAVE_DELAY_MS) {
  const { data, isLoading } = useSettingsQuery()
  const saveMutation = useSaveSettingsMutation()
  const queryClient = useQueryClient()
  const [local, setLocal] = useState<AppSettings | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<AppSettings | null>(null)

  useEffect(() => {
    if (data && !local) setLocal(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        const toSave = pendingRef.current
        pendingRef.current = null
        if (toSave) {
          void api.saveSettings(toSave)
          queryClient.setQueryData(SETTINGS_QUERY_KEY, toSave)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (patch: Partial<AppSettings>): void => {
    setLocal((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      pendingRef.current = next
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        pendingRef.current = null
        saveMutation.mutate(next)
      }, saveDelayMs)
      return next
    })
  }

  return { settings: local, update, isLoading: isLoading || !local }
}
