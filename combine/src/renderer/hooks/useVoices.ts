import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Provider } from '../../core/types/lesson-json'
import { api } from '../lib/api'
import { useDebouncedValue } from '../lib/useDebouncedValue'

/**
 * Некриптографический хэш — ТОЛЬКО чтобы не класть сырой apiKey в queryKey (виден в React Query
 * Devtools, живёт в памяти процесса как ключ кэша сколь угодно долго), но при этом React Query
 * всё равно отличал РАЗНЫЕ ключи друг от друга — простого boolean "задан/не задан" недостаточно:
 * смена одного реального ключа на другой обязана инвалидировать кэш голосов, иначе показались бы
 * голоса чужого/старого аккаунта, закешированные под тем же truthy-значением.
 */
function hashApiKey(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0
  }
  return h.toString(16)
}

/**
 * Мульти-верификаторное ревью (minor, useVoices.ts:7): раньше apiKey — сырой текст, который
 * пользователь ВВОДИТ вручную посимвольно (см. components/settings/ApiKeyField.tsx — value/
 * onChange без собственного дебаунса) — был частью queryKey БЕЗ дебаунса. Любое нажатие клавиши
 * при вводе ещё НЕ сохранённого ключа ElevenLabs немедленно меняло queryKey, и React Query
 * инициировал НАСТОЯЩИЙ GET /v1/voices на каждый промежуточный (заведомо неполный, гарантированно
 * 401) символ 40+-значного ключа. Теперь:
 *  1. apiKey дебаунсится тем же useDebouncedValue, что и живой парсинг (useParsedLesson) — запрос
 *     улетает только после паузы в наборе текста;
 *  2. в queryKey — не сам ключ, а его hashApiKey() (см. выше), т.е. секрет не оседает в кэше
 *     React Query/devtools как есть.
 * apiKey=null (ключ не введён на этом экране, но мог быть сохранён ранее через safeStorage — см.
 * useApiKey.ts) по-прежнему передаётся как есть: main сам подставит сохранённый ключ (D-22/D-23),
 * так что дебаунс не задерживает НАЧАЛЬНУЮ загрузку голосов при открытии экрана настроек.
 */
export function useVoicesQuery(provider: Provider, apiKey: string | null, delayMs = 400) {
  const debouncedApiKey = useDebouncedValue(apiKey, delayMs)
  const query = useQuery({
    queryKey: ['voices', provider, debouncedApiKey ? hashApiKey(debouncedApiKey) : null],
    queryFn: () => api.listVoices({ provider, apiKey: debouncedApiKey }),
    placeholderData: keepPreviousData
  })
  // Тот же приём, что useParsedLesson.ts — "не догнал ещё дебаунс" отдельно от react-query'шного
  // isPending (нет данных и идёт фактический fetch), чтобы вызывающий код мог отличить "печатает"
  // от "запрос в сети", если понадобится.
  return { ...query, debouncedApiKey, isPending: debouncedApiKey !== apiKey }
}
