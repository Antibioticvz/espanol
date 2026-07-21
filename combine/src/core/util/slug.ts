/**
 * Транслитерация RU → латиница и slug-функция для ключей групп/тем.
 * Используется парсером, когда явный ES-эквивалент недоступен (напр. #CATEGORY на русском).
 */

const RU_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
}

export function transliterate(input: string): string {
  return input
    .split('')
    .map((ch) => {
      const mapped = RU_TO_LATIN[ch.toLowerCase()]
      return mapped === undefined ? ch : mapped
    })
    .join('')
}

/** Приводит произвольную строку (RU/ES/др.) к kebab-case ASCII слагу. Никогда не возвращает пустую строку. */
export function slugify(input: string): string {
  const slug = transliterate(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // диакритика: á é í ó ú ñ → a e i o u n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return slug || 'x'
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
