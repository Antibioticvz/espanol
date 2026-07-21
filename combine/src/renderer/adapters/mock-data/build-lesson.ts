/**
 * Локальная (browser-safe) реализация "ParsedLesson → LessonJson", по духу аналогичная
 * combine/src/core/queue/build-items.ts#buildLessonSkeleton, но БЕЗ импорта node:path (тот модуль
 * непригоден для renderer-бандла — см. комментарий в mockAdapter.ts). Нужна только mockAdapter'у
 * для конструирования правдоподобных данных библиотеки/генерации из реальных образцов курса.
 *
 * Использует computeLessonStats из ./mock-parser (а не core/parser/parser.service.ts#computeStats)
 * — см. пояснение о TS-баге в шапке mock-parser.ts.
 */

import type { ParsedLesson } from '../../../core/types/parsed-lesson'
import type { BlockJson, GroupJson, ItemStatus, LessonJson, PhraseJson, Provider, VoiceRef } from '../../../core/types/lesson-json'
import { GENERATOR_VERSION, SCHEMA_VERSION } from '../../../core/types/lesson-json'
import { beepDurationMs } from './beep-audio'
import { computeLessonStats } from './mock-parser'

function audioRelPath(lang: 'es' | 'ru', slug: string): string {
  return `audio/${lang}/${slug}.mp3`
}

export interface BuildMockLessonOptions {
  provider: Provider
  model: string
  voiceEs: VoiceRef
  voiceRu: VoiceRef
  stability: number | null
  similarityBoost: number | null
  seed: number | null
  pricePerThousandChars: number
  createdAt: Date
  /** Статус i-го элемента (0-indexed, порядок обхода блоков/групп/фраз) из total элементов урока. */
  statusForIndex: (index: number, total: number) => ItemStatus
}

const RETRY_ERRORS = [
  '429 Too Many Requests — превышен лимит запросов после 3 попыток',
  'Timeout: сервер не ответил за 30 сек после 3 попыток'
]

export function buildMockLessonJson(lesson: ParsedLesson, opts: BuildMockLessonOptions): LessonJson {
  const stats = computeLessonStats(lesson)
  let cursor = 0
  let actualCostUsd = 0

  const statusAndMeta = (
    es: string,
    ru: string
  ): { status: ItemStatus; generatedAt: string | null; error: string | null; durationEs: number; durationRu: number } => {
    const status = opts.statusForIndex(cursor, stats.totalElements)
    const idx = cursor
    cursor += 1
    const durationEs = beepDurationMs(es)
    const durationRu = beepDurationMs(ru)
    if (status === 'done') {
      const chars = es.length + ru.length
      actualCostUsd += (chars / 1000) * opts.pricePerThousandChars
      const generatedAt = new Date(opts.createdAt.getTime() + idx * 45_000).toISOString()
      return { status, generatedAt, error: null, durationEs, durationRu }
    }
    if (status === 'failed') {
      return {
        status,
        generatedAt: null,
        error: RETRY_ERRORS[idx % RETRY_ERRORS.length],
        durationEs: 0,
        durationRu: 0
      }
    }
    return { status, generatedAt: null, error: null, durationEs: 0, durationRu: 0 }
  }

  const phraseToJson = (p: { id: string; es: string; ru: string }): PhraseJson => {
    const meta = statusAndMeta(p.es, p.ru)
    return {
      id: p.id,
      es: p.es,
      ru: p.ru,
      audio: { es: audioRelPath('es', p.id), ru: audioRelPath('ru', p.id) },
      duration_ms: { es: meta.durationEs, ru: meta.durationRu },
      status: meta.status,
      id3_tags_written: meta.status === 'done',
      generated_at: meta.generatedAt,
      error: meta.error
    }
  }

  // Порядок веток важен: проверяем оба ОДНОлитеральных дискриминанта ('vocabulary', 'story') явно и
  // ПЕРВЫМИ, оставляя мульти-литеральный член (ParsedBlockGroups.type: 'verb_group' | 'phrase_group')
  // неявным последним случаем. Если проверить его через составной `type==='verb_group'||type==='phrase_group'`
  // в середине цепочки, TS не сужает ПОСЛЕДУЮЩИЕ ветки корректно (не убирает ParsedBlockGroups из
  // остатка union) — известная особенность control-flow narrowing для member'ов с union-дискриминантом.
  // См. тот же приём и пояснение в mock-parser.ts/mockAdapter.ts/lessonTree.ts.
  const blocks: BlockJson[] = lesson.blocks.map((block) => {
    if (block.type === 'vocabulary') {
      return {
        block_id: block.blockId,
        type: 'vocabulary',
        title_ru: block.titleRu,
        title_es: block.titleEs,
        order_index: block.orderIndex,
        words: block.words.map(phraseToJson)
      }
    }
    if (block.type === 'story') {
      const slug = `${String(lesson.topicNumber).padStart(2, '0')}-${block.blockId}-story`
      const meta = statusAndMeta(block.textEs, block.textRu)
      return {
        block_id: block.blockId,
        type: 'story',
        title_ru: block.titleRu,
        title_es: block.titleEs,
        order_index: block.orderIndex,
        text_es: block.textEs,
        text_ru: block.textRu,
        audio: { es: audioRelPath('es', slug), ru: audioRelPath('ru', slug) },
        duration_ms: { es: meta.durationEs, ru: meta.durationRu },
        status: meta.status,
        split_by_phrase: false,
        id3_tags_written: meta.status === 'done',
        generated_at: meta.generatedAt,
        error: meta.error
      }
    }
    const groups: GroupJson[] = block.groups.map((g) => ({
      key: g.key,
      title_ru: g.titleRu,
      translation_ru: g.translationRu,
      order_index: g.orderIndex,
      phrases: g.phrases.map(phraseToJson)
    }))
    return {
      block_id: block.blockId,
      type: block.type,
      title_ru: block.titleRu,
      title_es: block.titleEs,
      order_index: block.orderIndex,
      groups
    }
  })

  const estimatedCostUsd = (stats.totalCharacters / 1000) * opts.pricePerThousandChars

  return {
    schema_version: SCHEMA_VERSION,
    topic_id: lesson.topicId,
    topic_number: lesson.topicNumber,
    title_ru: lesson.titleRu,
    title_es: lesson.titleEs,
    created_at: opts.createdAt.toISOString(),
    generator_version: GENERATOR_VERSION,
    config: {
      provider: opts.provider,
      model: opts.model,
      voice_es: opts.voiceEs,
      voice_ru: opts.voiceRu,
      stability: opts.stability,
      similarity_boost: opts.similarityBoost,
      seed: opts.seed
    },
    stats: {
      phrase_count: stats.phraseCount,
      vocab_count: stats.vocabCount,
      story_count: stats.storyCount,
      total_elements: stats.totalElements,
      characters_es: stats.charactersEs,
      characters_ru: stats.charactersRu,
      total_characters: stats.totalCharacters,
      estimated_cost_usd: Math.round(estimatedCostUsd * 100) / 100,
      actual_cost_usd: Math.round(actualCostUsd * 100) / 100,
      generation_duration_seconds: Math.round(stats.totalElements * 8.5),
      file_size_mb: Math.round(stats.totalElements * 0.42 * 10) / 10
    },
    blocks
  }
}

/** Статус-функции для сборки библиотеки: всё готово / всё в очереди / частично (демо "в процессе"). */
export const allDone = (): ItemStatus => 'done'

export function partialProgress(doneRatio: number, failRatio = 0.05) {
  return (index: number, total: number): ItemStatus => {
    const ratio = total > 0 ? index / total : 0
    if (ratio < doneRatio) return 'done'
    if (ratio < doneRatio + failRatio) return 'failed'
    return 'pending'
  }
}
