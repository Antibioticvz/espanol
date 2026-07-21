import { useQuery } from '@tanstack/react-query'
import type { EstimateCostInput } from '../../shared/ipc'
import { api } from '../lib/api'

export function useCostEstimate(input: EstimateCostInput) {
  return useQuery({
    queryKey: ['estimateCost', input],
    queryFn: () => api.estimateCost(input)
  })
}
