import { useEffect, useState } from 'react'

/** Возвращает значение с задержкой `delayMs` — используется для live-парсинга без дёрганья на каждый keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
