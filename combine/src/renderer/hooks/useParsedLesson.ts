import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { api } from '../lib/api'

/** Живой парсинг с debounce (см. docs/SPEC_COMBINE.md §4.1) — не дёргает parseText на каждый keystroke. */
export function useParsedLesson(rawText: string, delayMs = 300) {
  const debouncedText = useDebouncedValue(rawText, delayMs)
  const query = useQuery({
    queryKey: ['parseText', debouncedText],
    queryFn: () => api.parseText(debouncedText),
    enabled: debouncedText.trim().length > 0,
    placeholderData: keepPreviousData
  })
  return { ...query, debouncedText, isPending: debouncedText !== rawText }
}
