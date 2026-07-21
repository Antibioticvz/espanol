import { useMutation } from '@tanstack/react-query'
import type { GetPhraseAudioInput } from '../../shared/ipc'
import { api } from '../lib/api'

export function usePhraseAudioMutation() {
  return useMutation({ mutationFn: (input: GetPhraseAudioInput) => api.getPhraseAudio(input) })
}
