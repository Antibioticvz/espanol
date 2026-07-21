/**
 * Внутреннее представление разобранного (но ещё не озвученного) урока.
 * camelCase, в отличие от on-disk lesson-json.ts (snake_case). Строится ParserService,
 * потребляется build-items.ts/FileService для превращения в LessonJson.
 */

export interface ParsedPhrase {
  /** Итоговый id фразы, напр. 04-b1-llamarse-01 */
  id: string
  es: string
  ru: string
  /** Номер строки в исходном тексте (1-indexed) — для трассировки и логов */
  sourceLine: number
}

export interface ParsedGroup {
  key: string
  titleRu: string | null
  translationRu: string | null
  orderIndex: number
  phrases: ParsedPhrase[]
}

export interface ParsedBlockGroups {
  blockId: string
  type: 'verb_group' | 'phrase_group'
  titleRu: string
  titleEs: string | null
  orderIndex: number
  groups: ParsedGroup[]
}

export interface ParsedBlockVocabulary {
  blockId: string
  type: 'vocabulary'
  titleRu: string
  titleEs: string | null
  orderIndex: number
  words: ParsedPhrase[]
}

export interface ParsedBlockStory {
  blockId: string
  type: 'story'
  titleRu: string
  titleEs: string | null
  orderIndex: number
  textEs: string
  textRu: string
}

export type ParsedBlock = ParsedBlockGroups | ParsedBlockVocabulary | ParsedBlockStory

/**
 * Type guard, а не `block.type === 'verb_group' || block.type === 'phrase_group'` напрямую:
 * TypeScript не умеет сузить объединение по дискриминанту, значения которого сами являются
 * union'ом (`type: 'verb_group' | 'phrase_group'`), через `||`-сравнение в if/else-if цепочке —
 * итоговый `else` остаётся `ParsedBlockGroups | ParsedBlockStory` вместо чистого ParsedBlockStory.
 * Явный type guard узнаётся корректно. Проверено репродукцией на изолированном примере.
 */
export function isGroupsBlock(block: ParsedBlock): block is ParsedBlockGroups {
  return block.type === 'verb_group' || block.type === 'phrase_group'
}

export interface LanguageVariants {
  spanishRegion?: string
  speedMultiplier?: number
}

export interface ParsedLesson {
  topicId: string
  topicNumber: number
  titleRu: string
  titleEs: string | null
  languageVariants: LanguageVariants | null
  blocks: ParsedBlock[]
}

export interface ParserStats {
  blockCount: number
  phraseCount: number
  vocabCount: number
  storyCount: number
  totalElements: number
  charactersEs: number
  charactersRu: number
  totalCharacters: number
}

export interface ParseIssue {
  /** Номер строки в исходном файле (1-indexed), либо null для агрегатных ошибок блока/группы */
  line: number | null
  message: string
}

export interface ParseResult {
  lesson: ParsedLesson | null
  errors: ParseIssue[]
  warnings: ParseIssue[]
  stats: ParserStats
}

export function emptyStats(): ParserStats {
  return {
    blockCount: 0,
    phraseCount: 0,
    vocabCount: 0,
    storyCount: 0,
    totalElements: 0,
    charactersEs: 0,
    charactersRu: 0,
    totalCharacters: 0
  }
}
