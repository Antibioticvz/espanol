/**
 * Разбор вывода `say -v '?'` (список системных голосов macOS) и выбор голоса для ES/RU
 * с graceful fallback, если целевые голоса (Mónica/Milena) не установлены на машине
 * (актуально для CI и чужих машин — см. запрос координатора в этой задаче).
 *
 * Алгоритм resolveVoice/pickVoiceForLang:
 *  1. Если явно запрошенный voiceId установлен и его локаль соответствует lang — используем его.
 *  2. Иначе берём первый установленный голос с локалью "es_*" / "ru_*" (предпочитая Mónica/Milena, если
 *     они есть среди подходящих по локали).
 *  3. Если подходящих по локали голосов нет вообще — используем системный голос по умолчанию
 *     (вызов `say` без -v) и возвращаем предупреждение для лога/UI.
 */

export interface SystemVoice {
  name: string
  locale: string
  sample: string
}

// Пример строки: "Mónica              es_ES    # Hola, me llamo Mónica y soy una voz española."
const VOICE_LINE_RE = /^(.*\S)\s+([A-Za-z]{2}_[A-Za-z]{2})\s+#\s?(.*)$/

export function parseSayVoiceList(raw: string): SystemVoice[] {
  const voices: SystemVoice[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const m = line.match(VOICE_LINE_RE)
    if (!m) continue
    voices.push({ name: m[1].trim(), locale: m[2], sample: m[3] ?? '' })
  }
  return voices
}

export type MockLang = 'es' | 'ru'

export interface ResolvedMockVoice {
  id: string
  name: string
  usedFallback: boolean
  warning?: string
}

const LOCALE_PREFIX: Record<MockLang, string> = { es: 'es', ru: 'ru' }
const PREFERRED_NAME: Record<MockLang, string> = { es: 'Mónica', ru: 'Milena' }
const FALLBACK_ID = 'system-default'
const FALLBACK_NAME = 'Системный голос (по умолчанию macOS)'

export function pickVoiceForLang(
  voices: SystemVoice[],
  lang: MockLang,
  preferredId?: string | null
): ResolvedMockVoice {
  const prefix = `${LOCALE_PREFIX[lang]}_`

  if (preferredId) {
    const exact = voices.find((v) => v.name === preferredId)
    if (exact && exact.locale.toLowerCase().startsWith(prefix)) {
      return { id: exact.name, name: exact.name, usedFallback: false }
    }
  }

  const localeMatches = voices.filter((v) => v.locale.toLowerCase().startsWith(prefix))
  if (localeMatches.length > 0) {
    const byPreferredName = localeMatches.find((v) => v.name === PREFERRED_NAME[lang])
    const chosen = byPreferredName ?? localeMatches[0]
    return { id: chosen.name, name: chosen.name, usedFallback: false }
  }

  return {
    id: FALLBACK_ID,
    name: FALLBACK_NAME,
    usedFallback: true,
    warning:
      `Голос для языка "${lang}" (локаль ${prefix}*) не найден среди установленных голосов macOS ` +
      `(say -v '?'). Используется системный голос по умолчанию — произношение может быть неверным. ` +
      `Установите голос: Системные настройки → Специальные возможности → Контент речи → Голоса системы.`
  }
}
