import yaml from 'js-yaml'

export interface FrontMatterExtraction {
  data: Record<string, unknown> | null
  /** 0-based индекс строки в исходном массиве lines[], с которой нужно продолжить разбор тела. */
  bodyStartIndex: number
}

/**
 * Извлекает опциональный YAML front-matter (см. docs/SPEC_COMBINE.md §2.4).
 * Работает над уже разбитым на строки текстом, чтобы номера строк для ошибок совпадали
 * с исходным файлом без пересчёта смещений.
 */
export function extractFrontMatter(lines: string[]): FrontMatterExtraction {
  if (lines[0]?.trim() !== '---') {
    return { data: null, bodyStartIndex: 0 }
  }
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) {
    throw new Error('Не найдено закрывающее «---» для YAML front-matter (открыт на строке 1).')
  }
  const yamlText = lines.slice(1, endIdx).join('\n')
  let data: Record<string, unknown> | null = null
  try {
    const parsed = yaml.load(yamlText)
    if (parsed && typeof parsed === 'object') {
      data = parsed as Record<string, unknown>
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Ошибка разбора YAML front-matter (строки 2–${endIdx}): ${msg}`)
  }
  return { data, bodyStartIndex: endIdx + 1 }
}
