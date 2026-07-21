import { useMutation } from '@tanstack/react-query'
import type { TestSnippetInput } from '../../shared/ipc'
import { api } from '../lib/api'

export function useTestSnippetMutation() {
  return useMutation({ mutationFn: (input: TestSnippetInput) => api.testSnippet(input) })
}
