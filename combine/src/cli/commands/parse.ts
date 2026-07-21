import { readFileSync } from 'node:fs'
import { ParserService } from '../../core/parser/parser.service'
import { strFlag, type CliFlags } from '../args'

/** `cli parse --input <файл>` — headless-проверка формата (D-10), без генерации. */
export function runParse(flags: CliFlags): number {
  const input = strFlag(flags, 'input')
  if (!input) {
    console.error('Использование: parse --input <файл>')
    return 1
  }

  let raw: string
  try {
    raw = readFileSync(input, 'utf8')
  } catch (e) {
    console.error(`Не удалось прочитать файл ${input}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  const result = new ParserService().parse(raw)
  console.log(`Файл: ${input}`)
  if (result.lesson) {
    console.log(`Тема: #${result.lesson.topicNumber} — «${result.lesson.titleRu}» (${result.lesson.topicId})`)
  }
  console.log(`Блоков: ${result.stats.blockCount}`)
  console.log(`Фраз: ${result.stats.phraseCount}`)
  console.log(`Слов (vocabulary): ${result.stats.vocabCount}`)
  console.log(`Рассказов: ${result.stats.storyCount}`)
  console.log(`Символов ES: ${result.stats.charactersEs}`)
  console.log(`Символов RU: ${result.stats.charactersRu}`)
  console.log(`Ошибок: ${result.errors.length}`)
  console.log(`Предупреждений: ${result.warnings.length}`)
  for (const e of result.errors) {
    console.log(`  ⚠ ${e.line !== null ? `строка ${e.line}: ` : ''}${e.message}`)
  }
  for (const w of result.warnings) {
    console.log(`  ℹ ${w.line !== null ? `строка ${w.line}: ` : ''}${w.message}`)
  }
  console.log(result.errors.length === 0 ? 'Статус: готово к генерации.' : 'Статус: есть ошибки, генерация невозможна.')
  return result.errors.length > 0 ? 1 : 0
}
