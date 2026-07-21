import { useMutation } from '@tanstack/react-query'
import type { TestConnectionInput } from '../../shared/ipc'
import { api } from '../lib/api'

export function useTestConnectionMutation() {
  return useMutation({ mutationFn: (input: TestConnectionInput) => api.testConnection(input) })
}
