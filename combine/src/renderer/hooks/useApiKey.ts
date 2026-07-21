import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * Персистентность API-ключа (v1.2, D-23) — см. docstring у shared/ipc.ts#ApiKeyStatusResult.
 * getApiKeyStatus() НИКОГДА не возвращает сам ключ, только статус — компонент, показывающий
 * "ключ сохранён", не должен и не может показать сам ключ.
 */
export const API_KEY_STATUS_QUERY_KEY = ['apiKeyStatus'] as const

export function useApiKeyStatusQuery() {
  return useQuery({ queryKey: API_KEY_STATUS_QUERY_KEY, queryFn: () => api.getApiKeyStatus() })
}

export function useSaveApiKeyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (apiKey: string) => api.saveApiKey(apiKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEY_STATUS_QUERY_KEY })
    }
  })
}

export function useClearApiKeyMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearApiKey(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEY_STATUS_QUERY_KEY })
    }
  })
}
