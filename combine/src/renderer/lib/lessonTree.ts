/**
 * Строит презентационное дерево (блок → группа → фраза) из LessonJson для BlockTree/LessonJsonModal и
 * т.п. Отделено от адаптеров намеренно: это чистая функция представления, не завязанная на то, откуда
 * взялся LessonJson (mock-генерация, IPC-ответ, статический снимок библиотеки).
 */

import type { BlockType, ItemStatus, LessonJson } from '../../core/types/lesson-json'

export interface ItemStatusInfo {
  status: ItemStatus
  error?: string | null
  durationMs?: number | null
}

export interface TreePhrase extends ItemStatusInfo {
  id: string
  es: string
  ru: string
}

export interface TreeGroup {
  key: string
  title: string
  phrases: TreePhrase[]
}

export interface TreeBlock {
  blockId: string
  type: BlockType
  title: string
  groups?: TreeGroup[]
  words?: TreePhrase[]
  story?: TreePhrase
}

export function storySlugFor(lesson: Pick<LessonJson, 'topic_number'>, blockId: string): string {
  return `${String(lesson.topic_number).padStart(2, '0')}-${blockId}-story`
}

/**
 * Снимок статусов "как есть" из самого LessonJson — стартовая точка перед потоком live-событий.
 *
 * Порядок веток намеренный (см. тот же приём в adapters/mock-data/mock-parser.ts): проверяем ОДНОлитеральные
 * дискриминанты ('vocabulary', 'story') явно и первыми, мульти-литеральный член (BlockGroupsJson.type:
 * 'verb_group' | 'phrase_group') оставляем неявным последним случаем — иначе TS не сужает block корректно.
 */
export function initialStatusMap(lesson: LessonJson): Record<string, ItemStatusInfo> {
  const map: Record<string, ItemStatusInfo> = {}
  for (const block of lesson.blocks) {
    if (block.type === 'vocabulary') {
      for (const word of block.words) {
        map[word.id] = {
          status: word.status,
          error: word.error ?? null,
          durationMs: word.duration_ms.es + word.duration_ms.ru
        }
      }
    } else if (block.type === 'story') {
      const slug = storySlugFor(lesson, block.block_id)
      map[slug] = {
        status: block.status,
        error: block.error ?? null,
        durationMs: block.duration_ms.es + block.duration_ms.ru
      }
    } else {
      for (const group of block.groups) {
        for (const phrase of group.phrases) {
          map[phrase.id] = {
            status: phrase.status,
            error: phrase.error ?? null,
            durationMs: phrase.duration_ms.es + phrase.duration_ms.ru
          }
        }
      }
    }
  }
  return map
}

function statusOf(id: string, statusMap: Record<string, ItemStatusInfo>, fallback: ItemStatusInfo): ItemStatusInfo {
  return statusMap[id] ?? fallback
}

export function buildTree(lesson: LessonJson, statusMap: Record<string, ItemStatusInfo>): TreeBlock[] {
  return lesson.blocks
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((block) => {
      if (block.type === 'vocabulary') {
        return {
          blockId: block.block_id,
          type: 'vocabulary',
          title: block.title_ru,
          words: block.words.map((w) => ({
            id: w.id,
            es: w.es,
            ru: w.ru,
            ...statusOf(w.id, statusMap, { status: w.status, error: w.error, durationMs: null })
          }))
        }
      }
      if (block.type === 'story') {
        const slug = storySlugFor(lesson, block.block_id)
        return {
          blockId: block.block_id,
          type: 'story',
          title: block.title_ru,
          story: {
            id: slug,
            es: block.text_es,
            ru: block.text_ru,
            ...statusOf(slug, statusMap, { status: block.status, error: block.error, durationMs: null })
          }
        }
      }
      return {
        blockId: block.block_id,
        type: block.type,
        title: block.title_ru,
        groups: block.groups
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((g) => ({
            key: g.key,
            title: g.title_ru ?? g.translation_ru ?? g.key,
            phrases: g.phrases.map((p) => ({
              id: p.id,
              es: p.es,
              ru: p.ru,
              ...statusOf(p.id, statusMap, { status: p.status, error: p.error, durationMs: null })
            }))
          }))
      }
    })
}

export function countBlockItems(block: TreeBlock): { done: number; total: number } {
  const items = block.groups ? block.groups.flatMap((g) => g.phrases) : block.words ? block.words : block.story ? [block.story] : []
  return { done: items.filter((i) => i.status === 'done').length, total: items.length }
}

export function countGroupItems(group: TreeGroup): { done: number; total: number } {
  return { done: group.phrases.filter((p) => p.status === 'done').length, total: group.phrases.length }
}

export interface FlatPhrase {
  id: string
  es: string
  ru: string
}

/** Первые `limit` фраз урока (для встроенного плеера библиотеки — см. docs/SPEC_COMBINE.md §4.4). */
export function listPlayablePhrases(lesson: LessonJson, limit = 5): FlatPhrase[] {
  const result: FlatPhrase[] = []
  for (const block of lesson.blocks) {
    if (result.length >= limit) break
    if (block.type === 'vocabulary') {
      for (const word of block.words) {
        if (result.length >= limit) break
        result.push({ id: word.id, es: word.es, ru: word.ru })
      }
    } else if (block.type === 'story') {
      const slug = storySlugFor(lesson, block.block_id)
      result.push({ id: slug, es: block.text_es, ru: block.text_ru })
    } else {
      for (const group of block.groups) {
        for (const phrase of group.phrases) {
          if (result.length >= limit) break
          result.push({ id: phrase.id, es: phrase.es, ru: phrase.ru })
        }
      }
    }
  }
  return result
}
