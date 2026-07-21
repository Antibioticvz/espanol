import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GenerationRunRef } from '../../shared/ipc'
import { api } from '../lib/api'

export const LIBRARY_QUERY_KEY = ['library'] as const

export function useLibraryQuery() {
  return useQuery({ queryKey: LIBRARY_QUERY_KEY, queryFn: () => api.listLibrary() })
}

export function useLibraryActions() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY })

  const exportZip = useMutation({ mutationFn: (ref: GenerationRunRef) => api.exportZip(ref) })
  const exportAnki = useMutation({ mutationFn: (ref: GenerationRunRef) => api.exportAnki(ref) })
  const regenerateAll = useMutation({
    mutationFn: (ref: GenerationRunRef) => api.regenerateAll(ref),
    onSuccess: invalidate
  })
  const regenerateFailed = useMutation({
    mutationFn: (ref: GenerationRunRef) => api.regenerateFailed(ref),
    onSuccess: invalidate
  })
  const deleteLesson = useMutation({
    mutationFn: (ref: GenerationRunRef) => api.deleteLesson(ref),
    onSuccess: invalidate
  })
  const openLessonFolder = useMutation({ mutationFn: (ref: GenerationRunRef) => api.openLessonFolder(ref) })

  return { exportZip, exportAnki, regenerateAll, regenerateFailed, deleteLesson, openLessonFolder, invalidate }
}
