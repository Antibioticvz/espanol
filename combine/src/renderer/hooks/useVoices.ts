import { useQuery } from '@tanstack/react-query'
import type { Provider } from '../../core/types/lesson-json'
import { api } from '../lib/api'

export function useVoicesQuery(provider: Provider, apiKey: string | null) {
  return useQuery({
    queryKey: ['voices', provider, apiKey],
    queryFn: () => api.listVoices({ provider, apiKey })
  })
}
