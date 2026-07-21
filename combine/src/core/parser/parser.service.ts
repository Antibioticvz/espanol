import type {
  ParsedBlock,
  ParsedGroup,
  ParsedLesson,
  ParsedPhrase,
  ParseIssue,
  ParseResult,
  ParserStats,
  LanguageVariants
} from '../types/parsed-lesson'
import { emptyStats } from '../types/parsed-lesson'
import type { BlockType } from '../types/lesson-json'
import { extractFrontMatter } from './front-matter'
import { pad2, slugify } from '../util/slug'

const BLOCK_TYPES: BlockType[] = ['verb_group', 'phrase_group', 'vocabulary', 'story']

/** Внутреннее мутируемое состояние текущего блока во время построчного разбора. */
interface WorkingBlock {
  blockId: string
  type: BlockType
  titleRu: string
  titleEs: string | null
  /** строка объявления ##BLOCK — для агрегатных ошибок/предупреждений */
  declLine: number
  groups: ParsedGroup[]
  groupsByKey: Map<string, ParsedGroup>
  words: ParsedPhrase[]
  vocabIndex: number
  textEs: string
  textRu: string
  pendingEs: { line: number; text: string } | null
}

function splitOnce(s: string, sep: string): [string, string] | null {
  const idx = s.indexOf(sep)
  if (idx === -1) return null
  return [s.slice(0, idx), s.slice(idx + sep.length)]
}

/**
 * ParserService — разбор входного формата #TOPIC/##BLOCK/#WORD/#CATEGORY/ES:RU: (см. docs/SPEC_COMBINE.md §2).
 * Best-effort: некорректные строки/группы/блоки пропускаются с записью ошибки на конкретной строке,
 * а не обрывают разбор целиком — только отсутствие #TOPIC или отсутствие валидных блоков фатальны
 * (lesson=null). Никаких побочных эффектов (fs/network) — чистая функция строки → результат.
 */
export class ParserService {
  parse(raw: string): ParseResult {
    const errors: ParseIssue[] = []
    const warnings: ParseIssue[] = []
    const lines = raw.split(/\r\n|\r|\n/)

    let frontMatter: Record<string, unknown> | null = null
    let startIndex = 0
    try {
      const fm = extractFrontMatter(lines)
      frontMatter = fm.data
      startIndex = fm.bodyStartIndex
    } catch (e) {
      errors.push({ line: 1, message: e instanceof Error ? e.message : String(e) })
      return { lesson: null, errors, warnings, stats: emptyStats() }
    }

    let topicNumber: number | null = null
    let topicTitleRu: string | null = null
    let topicLine: number | null = null

    const blocks: ParsedBlock[] = []
    let current: WorkingBlock | null = null
    let currentGroup: ParsedGroup | null = null

    const finalizeCurrentBlock = (): void => {
      if (!current) return
      const block = current
      if (block.type === 'verb_group' || block.type === 'phrase_group') {
        const nonEmpty = block.groups.filter((g) => {
          if (g.phrases.length === 0) {
            warnings.push({
              line: block.declLine,
              message: `Группа «${g.key}» в блоке «${block.titleRu}» (${block.blockId}) не содержит фраз и пропущена.`
            })
            return false
          }
          return true
        })
        if (nonEmpty.length === 0) {
          errors.push({
            line: block.declLine,
            message: `Блок «${block.titleRu}» (${block.blockId}, строка ${block.declLine}) не содержит ни одной группы с фразами.`
          })
        } else {
          blocks.push({
            blockId: block.blockId,
            type: block.type,
            titleRu: block.titleRu,
            titleEs: block.titleEs,
            orderIndex: blocks.length,
            groups: nonEmpty
          })
        }
      } else if (block.type === 'vocabulary') {
        if (block.words.length === 0) {
          errors.push({
            line: block.declLine,
            message: `Блок vocabulary «${block.titleRu}» (${block.blockId}, строка ${block.declLine}) не содержит слов.`
          })
        } else {
          blocks.push({
            blockId: block.blockId,
            type: 'vocabulary',
            titleRu: block.titleRu,
            titleEs: block.titleEs,
            orderIndex: blocks.length,
            words: block.words
          })
        }
      } else {
        // story
        if (block.pendingEs) {
          errors.push({
            line: block.pendingEs.line,
            message: `Строка ES: (строка ${block.pendingEs.line}) без соответствующей RU: сразу после неё.`
          })
        }
        if (!block.textEs || !block.textRu) {
          errors.push({
            line: block.declLine,
            message: `Блок story «${block.titleRu}» (${block.blockId}, строка ${block.declLine}) не содержит пары ES:/RU:.`
          })
        } else {
          blocks.push({
            blockId: block.blockId,
            type: 'story',
            titleRu: block.titleRu,
            titleEs: block.titleEs,
            orderIndex: blocks.length,
            textEs: block.textEs,
            textRu: block.textRu
          })
        }
      }
      current = null
      currentGroup = null
    }

    for (let i = startIndex; i < lines.length; i++) {
      const lineNo = i + 1
      const line = lines[i].trim()
      if (line === '') continue

      if (line.startsWith('##BLOCK')) {
        finalizeCurrentBlock()
        const rest = line.slice('##BLOCK'.length).trim()
        const parts = splitOnce(rest, '|')
        if (!parts) {
          errors.push({
            line: lineNo,
            message: `Некорректный формат ##BLOCK на строке ${lineNo}: ожидается «##BLOCK <тип> | <название>».`
          })
          continue
        }
        const type = parts[0].trim()
        const title = parts[1].trim()
        if (!BLOCK_TYPES.includes(type as BlockType)) {
          errors.push({
            line: lineNo,
            message: `Неизвестный тип блока «${type}» на строке ${lineNo}. Допустимые типы: ${BLOCK_TYPES.join(', ')}.`
          })
          continue
        }
        if (!title) {
          errors.push({ line: lineNo, message: `Пустое название блока на строке ${lineNo}.` })
          continue
        }
        const blockId = `b${blocks.length + 1}`
        current = {
          blockId,
          type: type as BlockType,
          titleRu: title,
          titleEs: null,
          declLine: lineNo,
          groups: [],
          groupsByKey: new Map(),
          words: [],
          vocabIndex: 0,
          textEs: '',
          textRu: '',
          pendingEs: null
        }
        currentGroup = null
        continue
      }

      if (line.startsWith('#TOPIC')) {
        const rest = line.slice('#TOPIC'.length).trim()
        const parts = splitOnce(rest, '|')
        if (!parts) {
          errors.push({
            line: lineNo,
            message: `Некорректный формат #TOPIC на строке ${lineNo}: ожидается «#TOPIC <номер> | <название>».`
          })
          continue
        }
        const numText = parts[0].trim()
        const title = parts[1].trim()
        const num = Number(numText)
        if (!/^\d+$/.test(numText) || !Number.isInteger(num) || num < 1) {
          errors.push({
            line: lineNo,
            message: `Номер темы «${numText}» на строке ${lineNo} должен быть положительным целым числом.`
          })
          continue
        }
        if (!title) {
          errors.push({ line: lineNo, message: `Пустое название темы на строке ${lineNo}.` })
          continue
        }
        if (topicNumber !== null) {
          errors.push({
            line: lineNo,
            message: `Повторный #TOPIC на строке ${lineNo} (первый — на строке ${topicLine}). Разрешён только один заголовок темы.`
          })
          continue
        }
        topicNumber = num
        topicTitleRu = title
        topicLine = lineNo
        continue
      }

      if (line.startsWith('#WORD')) {
        if (!current) {
          errors.push({ line: lineNo, message: `#WORD на строке ${lineNo} встречен до объявления ##BLOCK.` })
          continue
        }
        if (current.type !== 'verb_group') {
          errors.push({
            line: lineNo,
            message: `#WORD на строке ${lineNo} недопустим в блоке типа «${current.type}» (ожидается verb_group).`
          })
          continue
        }
        const rest = line.slice('#WORD'.length).trim()
        const parts = splitOnce(rest, '|')
        if (!parts || !parts[0].trim() || !parts[1].trim()) {
          errors.push({
            line: lineNo,
            message: `Некорректный формат #WORD на строке ${lineNo}: ожидается «#WORD <слово> | <перевод>».`
          })
          continue
        }
        const word = parts[0].trim()
        const translation = parts[1].trim()
        const key = slugify(word)
        const existing = current.groupsByKey.get(key)
        if (existing) {
          // Дубль ключа группы в ПРЕДЕЛАХ ОДНОГО блока — ошибка валидации (тот же ключ в РАЗНЫХ
          // блоках допустим, т.к. id уникален за счёт block_id — см. docs/DECISIONS.md и topic-04:
          // "tener" в b1/b3, "ser" в b1/b2). Фразы всё же объединяются в существующую группу
          // (best-effort), чтобы не терять контент, но это отмечается как ошибка формата.
          errors.push({
            line: lineNo,
            message: `Дублирующийся ключ группы «${key}» в блоке «${current.titleRu}» (${current.blockId}, строка ${lineNo}) — используйте разные слова/категории в пределах одного блока. Фразы объединены с первой группой.`
          })
          currentGroup = existing
        } else {
          const group: ParsedGroup = {
            key,
            titleRu: null,
            translationRu: translation,
            orderIndex: current.groups.length,
            phrases: []
          }
          current.groups.push(group)
          current.groupsByKey.set(key, group)
          currentGroup = group
        }
        continue
      }

      if (line.startsWith('#CATEGORY')) {
        if (!current) {
          errors.push({ line: lineNo, message: `#CATEGORY на строке ${lineNo} встречен до объявления ##BLOCK.` })
          continue
        }
        if (current.type !== 'phrase_group') {
          errors.push({
            line: lineNo,
            message: `#CATEGORY на строке ${lineNo} недопустим в блоке типа «${current.type}» (ожидается phrase_group).`
          })
          continue
        }
        const title = line.slice('#CATEGORY'.length).trim()
        if (!title) {
          errors.push({ line: lineNo, message: `Пустое название категории на строке ${lineNo}.` })
          continue
        }
        const key = slugify(title)
        const existing = current.groupsByKey.get(key)
        if (existing) {
          // См. комментарий в ветке #WORD выше: дубль ключа в ПРЕДЕЛАХ ОДНОГО блока — ошибка.
          errors.push({
            line: lineNo,
            message: `Дублирующаяся категория «${title}» в блоке «${current.titleRu}» (${current.blockId}, строка ${lineNo}) — слаг «${key}» совпадает с уже объявленной («${existing.titleRu}»). Фразы объединены с первой категорией.`
          })
          currentGroup = existing
        } else {
          const group: ParsedGroup = {
            key,
            titleRu: title,
            translationRu: null,
            orderIndex: current.groups.length,
            phrases: []
          }
          current.groups.push(group)
          current.groupsByKey.set(key, group)
          currentGroup = group
        }
        continue
      }

      if (line.startsWith('ES:')) {
        if (!current || current.type !== 'story') {
          errors.push({ line: lineNo, message: `ES: на строке ${lineNo} допустимо только внутри блока story.` })
          continue
        }
        const text = line.slice('ES:'.length).trim()
        if (!text) {
          errors.push({ line: lineNo, message: `Пустой текст после ES: на строке ${lineNo}.` })
          continue
        }
        if (current.textEs && current.textRu) {
          errors.push({
            line: lineNo,
            message: `Блок story поддерживает только одну пару ES:/RU: — лишняя ES: на строке ${lineNo} проигнорирована.`
          })
          continue
        }
        if (current.pendingEs) {
          errors.push({
            line: lineNo,
            message: `Повторная ES: на строке ${lineNo} без RU: после предыдущей (строка ${current.pendingEs.line}) — проигнорирована.`
          })
          continue
        }
        current.pendingEs = { line: lineNo, text }
        continue
      }

      if (line.startsWith('RU:')) {
        if (!current || current.type !== 'story') {
          errors.push({ line: lineNo, message: `RU: на строке ${lineNo} допустимо только внутри блока story.` })
          continue
        }
        const text = line.slice('RU:'.length).trim()
        if (!text) {
          errors.push({ line: lineNo, message: `Пустой текст после RU: на строке ${lineNo}.` })
          continue
        }
        if (!current.pendingEs) {
          errors.push({ line: lineNo, message: `RU: на строке ${lineNo} без предшествующей ES:.` })
          continue
        }
        current.textEs = current.pendingEs.text
        current.textRu = text
        current.pendingEs = null
        continue
      }

      if (line.startsWith('#')) {
        errors.push({
          line: lineNo,
          message: `Неизвестная директива на строке ${lineNo}: «${line}». Ожидались #TOPIC, ##BLOCK, #WORD, #CATEGORY.`
        })
        continue
      }

      // Обычная фраза "ES | RU"
      if (!current) {
        errors.push({ line: lineNo, message: `Текст на строке ${lineNo} встречен до объявления ##BLOCK.` })
        continue
      }
      if (current.type === 'story') {
        errors.push({
          line: lineNo,
          message: `Внутри блока story ожидаются строки ES:/RU:, а не «ES | RU» (строка ${lineNo}).`
        })
        continue
      }
      const parts = splitOnce(line, '|')
      if (!parts) {
        errors.push({ line: lineNo, message: `Фраза без разделителя «|» на строке ${lineNo}: «${line}».` })
        continue
      }
      const es = parts[0].trim()
      const ru = parts[1].trim()
      if (!es || !ru) {
        errors.push({ line: lineNo, message: `Пустая часть фразы (ES или RU) на строке ${lineNo}.` })
        continue
      }
      if (current.type === 'vocabulary') {
        current.vocabIndex += 1
        const id = `${pad2(topicNumber ?? 0)}-${current.blockId}-vocab-${pad2(current.vocabIndex)}`
        current.words.push({ id, es, ru, sourceLine: lineNo })
        continue
      }
      // verb_group / phrase_group
      if (!currentGroup) {
        errors.push({
          line: lineNo,
          message: `Фраза на строке ${lineNo} встречена до заголовка группы (#WORD/#CATEGORY).`
        })
        continue
      }
      const idx = currentGroup.phrases.length + 1
      const id = `${pad2(topicNumber ?? 0)}-${current.blockId}-${currentGroup.key}-${pad2(idx)}`
      currentGroup.phrases.push({ id, es, ru, sourceLine: lineNo })
    }

    finalizeCurrentBlock()

    if (topicNumber === null || topicTitleRu === null) {
      // Если уже есть конкретная ошибка про #TOPIC (напр. неверный формат конкретной строки),
      // не дублируем её общим сообщением — иначе errors[0] стал бы менее информативным дубликатом.
      if (!errors.some((e) => e.message.includes('#TOPIC'))) {
        errors.unshift({ line: null, message: 'Не найден заголовок #TOPIC. Файл должен начинаться с «#TOPIC <номер> | <название>».' })
      }
      return { lesson: null, errors, warnings, stats: emptyStats() }
    }
    if (blocks.length === 0) {
      errors.push({ line: null, message: 'Не найдено ни одного корректного ##BLOCK с содержимым.' })
      return { lesson: null, errors, warnings, stats: emptyStats() }
    }

    // YAML front-matter: сверка и обогащение (не фатально при расхождениях — только warning)
    let titleEs: string | null = null
    let topicId = `${pad2(topicNumber)}-${slugify(topicTitleRu)}`
    let languageVariants: LanguageVariants | null = null

    if (frontMatter) {
      if (typeof frontMatter.title_es === 'string' && frontMatter.title_es.trim()) {
        titleEs = frontMatter.title_es.trim()
      }
      if (typeof frontMatter.title_ru === 'string' && frontMatter.title_ru.trim() && frontMatter.title_ru.trim() !== topicTitleRu) {
        warnings.push({
          line: null,
          message: `title_ru в YAML («${frontMatter.title_ru}») отличается от #TOPIC («${topicTitleRu}») — используется значение из #TOPIC.`
        })
      }
      if (typeof frontMatter.topic_number === 'number' && frontMatter.topic_number !== topicNumber) {
        warnings.push({
          line: null,
          message: `topic_number в YAML (${frontMatter.topic_number}) не совпадает с #TOPIC (${topicNumber}) — используется значение из #TOPIC.`
        })
      }
      if (typeof frontMatter.topic_id === 'string' && frontMatter.topic_id.trim()) {
        const candidate = frontMatter.topic_id.trim()
        if (/^[0-9]{2}-[a-z0-9-]+$/.test(candidate)) {
          topicId = candidate
        } else {
          warnings.push({
            line: null,
            message: `topic_id в YAML («${candidate}») не соответствует формату «NN-slug» — используется автоматически сгенерированный «${topicId}».`
          })
        }
      }
      const lv = frontMatter.language_variants
      if (lv && typeof lv === 'object') {
        const lvObj = lv as Record<string, unknown>
        languageVariants = {
          spanishRegion: typeof lvObj.spanish_region === 'string' ? lvObj.spanish_region : undefined,
          speedMultiplier: typeof lvObj.speed_multiplier === 'number' ? lvObj.speed_multiplier : undefined
        }
      }
    }

    const lesson: ParsedLesson = {
      topicId,
      topicNumber,
      titleRu: topicTitleRu,
      titleEs,
      languageVariants,
      blocks
    }

    return { lesson, errors, warnings, stats: computeStats(lesson) }
  }
}

export function computeStats(lesson: ParsedLesson): ParserStats {
  let phraseCount = 0
  let vocabCount = 0
  let storyCount = 0
  let charactersEs = 0
  let charactersRu = 0

  for (const block of lesson.blocks) {
    if (block.type === 'verb_group' || block.type === 'phrase_group') {
      for (const group of block.groups) {
        for (const phrase of group.phrases) {
          phraseCount += 1
          charactersEs += phrase.es.length
          charactersRu += phrase.ru.length
        }
      }
    } else if (block.type === 'vocabulary') {
      for (const word of block.words) {
        vocabCount += 1
        charactersEs += word.es.length
        charactersRu += word.ru.length
      }
    } else {
      storyCount += 1
      charactersEs += block.textEs.length
      charactersRu += block.textRu.length
    }
  }

  const totalElements = phraseCount + vocabCount + storyCount
  return {
    blockCount: lesson.blocks.length,
    phraseCount,
    vocabCount,
    storyCount,
    totalElements,
    charactersEs,
    charactersRu,
    totalCharacters: charactersEs + charactersRu
  }
}
