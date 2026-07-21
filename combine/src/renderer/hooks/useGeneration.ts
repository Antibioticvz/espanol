import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { LessonJson } from '../../core/types/lesson-json'
import type { GenerationProgressEvent } from '../../core/types/generation'
import type { GenerationRunRef, StartGenerationInput, StartGenerationResult } from '../../shared/ipc'
import { api } from '../lib/api'
import { LIBRARY_QUERY_KEY } from './useLibrary'
import { buildTree, initialStatusMap, type ItemStatusInfo, type TreeBlock } from '../lib/lessonTree'

const MAX_LOG_LINES = 300

/**
 * Живой стейт экрана генерации. Дерево блоков строится из СТАТИЧЕСКОГО скелета (StartGenerationResult.lesson)
 * + потокового statusMap, обновляемого по item-патчам onGenerationProgress (см. комментарий в shared/ipc.ts —
 * GenerationProgressEvent намеренно несёт только агрегаты и патч одного элемента, не всё дерево целиком).
 */
export function useGeneration() {
  const queryClient = useQueryClient()
  const [topicId, setTopicId] = useState<string | null>(null)
  const [lesson, setLesson] = useState<LessonJson | null>(null)
  const [statusMap, setStatusMap] = useState<Record<string, ItemStatusInfo>>({})
  const [progress, setProgress] = useState<GenerationProgressEvent | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  useEffect(() => {
    const unsubscribe = api.onGenerationProgress((event) => {
      setProgress(event)
      if (event.logLine) {
        setLogs((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), event.logLine as string])
      }
      if (event.item) {
        const item = event.item
        setStatusMap((prev) => ({
          ...prev,
          [item.phraseId]: {
            status: item.status,
            error: item.error ?? null,
            durationMs: item.durationMs ?? prev[item.phraseId]?.durationMs ?? null
          }
        }))
      }
      if (event.runState === 'done' || event.runState === 'cancelled') {
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY })
      }
    })
    return unsubscribe
  }, [queryClient])

  const attach = useCallback((result: StartGenerationResult) => {
    setTopicId(result.topicId)
    setLesson(result.lesson)
    setStatusMap(initialStatusMap(result.lesson))
    setProgress(null)
    setLogs([])
  }, [])

  /**
   * Мульти-верификаторное ревью: main держит генерацию активной независимо от того, сколько
   * renderer-окон на неё смотрят (macOS — закрытие окна не завершает процесс, см.
   * generation-session.ts). Без этого пересозданное/перезагруженное окно стартовало с topicId=null
   * и молча "теряло" реально работающий (и тратящий деньги) прогон — экран показывал «генерация
   * не запущена», Пауза/Отмена были недоступны (гейтятся на topicId), а «Возобновить»/«Переделать»
   * из библиотеки лишь падали с «уже выполняется» без видимой причины. При монтировании — один раз —
   * спрашиваем main о снимке активного прогона и переподключаемся, если он есть.
   */
  useEffect(() => {
    let cancelled = false
    void api.getActiveGeneration().then((active) => {
      if (cancelled || !active) return
      attach({ topicId: active.topicId, lesson: active.lesson })
      // attach() выше сбрасывает progress в null — синтезируем стартовый снимок с ПРАВИЛЬНЫМ
      // runState немедленно (Пауза/Отмена/Возобновить читают именно progress?.runState), не
      // дожидаясь следующего живого события onGenerationProgress, которое может прийти нескоро
      // (напр. сессия сейчас на паузе и ничего не эмитит, пока пользователь не нажмёт «Возобновить»).
      setProgress({
        runState: active.runState,
        totalItems: 0,
        doneItems: 0,
        failedItems: 0,
        pendingItems: 0,
        generatingItems: 0,
        currentItemId: null,
        currentText: null,
        elapsedMs: 0,
        speedPerMin: 0,
        etaSeconds: null,
        spentUsd: 0
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startMutation = useMutation({
    mutationFn: (input: StartGenerationInput) => api.startGeneration(input),
    onSuccess: (result) => {
      attach(result)
      void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY })
    }
  })
  const pauseMutation = useMutation({ mutationFn: (ref: GenerationRunRef) => api.pauseGeneration(ref) })
  const resumeMutation = useMutation({ mutationFn: (ref: GenerationRunRef) => api.resumeGeneration(ref) })
  const cancelMutation = useMutation({ mutationFn: (ref: GenerationRunRef) => api.cancelGeneration(ref) })

  const tree = useMemo<TreeBlock[]>(() => (lesson ? buildTree(lesson, statusMap) : []), [lesson, statusMap])

  return {
    topicId,
    lesson,
    tree,
    progress,
    logs,
    isStarting: startMutation.isPending,
    startError: startMutation.error,
    start: (input: StartGenerationInput) => startMutation.mutate(input),
    attach,
    pause: () => topicId && pauseMutation.mutate({ topicId }),
    resume: () => topicId && resumeMutation.mutate({ topicId }),
    cancel: () => topicId && cancelMutation.mutate({ topicId }),
    isPaused: progress?.runState === 'paused',
    isRunning: progress?.runState === 'running',
    isDone: progress?.runState === 'done',
    isCancelled: progress?.runState === 'cancelled'
  }
}

export type UseGenerationReturn = ReturnType<typeof useGeneration>
