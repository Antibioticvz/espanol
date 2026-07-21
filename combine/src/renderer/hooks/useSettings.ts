import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '../../core/types/settings'
import { api } from '../lib/api'

export const SETTINGS_QUERY_KEY = ['settings'] as const

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
 */
export function useEditableSettings() {
  const { data, isLoading } = useSettingsQuery()
  const saveMutation = useSaveSettingsMutation()
  const [local, setLocal] = useState<AppSettings | null>(null)

  useEffect(() => {
    if (data && !local) setLocal(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const update = (patch: Partial<AppSettings>): void => {
    setLocal((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      saveMutation.mutate(next)
      return next
    })
  }

  return { settings: local, update, isLoading: isLoading || !local }
}
