import { join } from 'node:path'
import type { ParsedLesson, ParsedPhrase } from '../types/parsed-lesson'
import { isGroupsBlock } from '../types/parsed-lesson'
import type { BlockJson, GroupJson, LessonJson, PhraseJson, Provider, VoiceRef } from '../types/lesson-json'
import { GENERATOR_VERSION, SCHEMA_VERSION, isGroupsBlockJson } from '../types/lesson-json'
import type { GenerationTask } from '../types/generation'
import { pad2 } from '../util/slug'

export interface SessionVoices {
  es: VoiceRef
  ru: VoiceRef
}

export interface BuildSessionOptions {
  provider: Provider
  model: string
  voices: SessionVoices
  stability: number | null
  similarityBoost: number | null
  seed: number | null
}

function audioRelPath(lang: 'es' | 'ru', slug: string): string {
  return `audio/${lang}/${slug}.mp3`
}

function phraseToJson(p: ParsedPhrase): PhraseJson {
  return {
    id: p.id,
    es: p.es,
    ru: p.ru,
    audio: { es: audioRelPath('es', p.id), ru: audioRelPath('ru', p.id) },
    duration_ms: { es: 0, ru: 0 },
    status: 'pending',
    id3_tags_written: false,
    generated_at: null,
    error: null
  }
}

/** Синтетический "id" для файлов рассказа — story не имеет собственного поля id в схеме. */
export function storySlug(topicNumber: number, blockId: string): string {
  return `${pad2(topicNumber)}-${blockId}-story`
}

/** Строит нулевой (ещё не озвученный) LessonJson из результата парсера — источник истины для queue/FileService. */
export function buildLessonSkeleton(
  lesson: ParsedLesson,
  opts: BuildSessionOptions,
  stats: {
    phraseCount: number
    vocabCount: number
    storyCount: number
    totalElements: number
    charactersEs: number
    charactersRu: number
    totalCharacters: number
  }
): LessonJson {
  const blocks: BlockJson[] = lesson.blocks.map((block) => {
    if (isGroupsBlock(block)) {
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
    }
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
    const slug = storySlug(lesson.topicNumber, block.blockId)
    return {
      block_id: block.blockId,
      type: 'story',
      title_ru: block.titleRu,
      title_es: block.titleEs,
      order_index: block.orderIndex,
      text_es: block.textEs,
      text_ru: block.textRu,
      audio: { es: audioRelPath('es', slug), ru: audioRelPath('ru', slug) },
      duration_ms: { es: 0, ru: 0 },
      status: 'pending',
      split_by_phrase: false,
      id3_tags_written: false,
      generated_at: null,
      error: null
    }
  })

  return {
    schema_version: SCHEMA_VERSION,
    topic_id: lesson.topicId,
    topic_number: lesson.topicNumber,
    title_ru: lesson.titleRu,
    title_es: lesson.titleEs,
    created_at: new Date().toISOString(),
    generator_version: GENERATOR_VERSION,
    config: {
      provider: opts.provider,
      model: opts.model,
      voice_es: opts.voices.es,
      voice_ru: opts.voices.ru,
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
      estimated_cost_usd: null,
      actual_cost_usd: null,
      generation_duration_seconds: null,
      file_size_mb: null
    },
    blocks
  }
}

/**
 * Строит плоский список задач очереди из LessonJson (после buildLessonSkeleton или загруженного
 * с диска для resume). Задачи для фраз/слов со status='done' не включаются (идемпотентность —
 * см. docs/SPEC_COMBINE.md §4.3, "resume берёт только pending+failed").
 */
export function flattenToTasks(lessonJson: LessonJson, audioRoot: string, voices: SessionVoices): GenerationTask[] {
  const tasks: GenerationTask[] = []

  const pushTask = (
    phraseId: string,
    blockId: string,
    blockType: BlockJson['type'],
    groupKey: string | null,
    esText: string,
    ruText: string,
    audioEs: string,
    audioRu: string,
    status: PhraseJson['status']
  ): void => {
    if (status === 'done') return
    tasks.push({
      phraseId,
      blockId,
      blockType,
      groupKey,
      esText,
      ruText,
      esOutPath: join(audioRoot, ...audioEs.split('/')),
      ruOutPath: join(audioRoot, ...audioRu.split('/')),
      esVoiceId: voices.es.id,
      esVoiceName: voices.es.name,
      ruVoiceId: voices.ru.id,
      ruVoiceName: voices.ru.name,
      status: 'pending',
      error: null,
      esDurationMs: null,
      ruDurationMs: null,
      esCharacters: null,
      ruCharacters: null
    })
  }

  for (const block of lessonJson.blocks) {
    if (isGroupsBlockJson(block)) {
      for (const group of block.groups) {
        for (const phrase of group.phrases) {
          pushTask(phrase.id, block.block_id, block.type, group.key, phrase.es, phrase.ru, phrase.audio.es, phrase.audio.ru, phrase.status)
        }
      }
    } else if (block.type === 'vocabulary') {
      for (const word of block.words) {
        pushTask(word.id, block.block_id, block.type, null, word.es, word.ru, word.audio.es, word.audio.ru, word.status)
      }
    } else {
      const slug = storySlug(lessonJson.topic_number, block.block_id)
      pushTask(slug, block.block_id, block.type, null, block.text_es, block.text_ru, block.audio.es, block.audio.ru, block.status)
    }
  }

  return tasks
}

/**
 * Находит JSON-узел (phrase/word/story) по задаче и применяет к нему patch. Мутирует lessonJson.
 *
 * ВАЖНО: промах поиска (нет блока/группы/фразы с таким id) логируется через console.warn, а не
 * тихо игнорируется — иначе результат генерации (готовый MP3, статус done) молча теряется,
 * а фраза в lesson.json навсегда останется pending, при этом ни в логах, ни в UI не будет ни
 * малейшего намёка на причину.
 */
export function applyTaskResult(lessonJson: LessonJson, task: GenerationTask): void {
  const block = lessonJson.blocks.find((b) => b.block_id === task.blockId)
  if (!block) {
    console.warn(`[build-items] applyTaskResult: не найден block_id="${task.blockId}" для задачи ${task.phraseId} — результат потерян.`)
    return
  }

  const patch = {
    status: task.status,
    duration_ms: { es: task.esDurationMs ?? 0, ru: task.ruDurationMs ?? 0 },
    error: task.error,
    generated_at: task.status === 'done' ? new Date().toISOString() : null
  }

  if (block.type === 'story') {
    Object.assign(block, patch)
    return
  }
  if (block.type === 'vocabulary') {
    const word = block.words.find((w) => w.id === task.phraseId)
    if (!word) {
      console.warn(`[build-items] applyTaskResult: не найдено слово id="${task.phraseId}" в блоке ${task.blockId} — результат потерян.`)
      return
    }
    Object.assign(word, patch)
    return
  }
  const group = block.groups.find((g) => g.key === task.groupKey)
  if (!group) {
    console.warn(
      `[build-items] applyTaskResult: не найдена группа key="${task.groupKey}" в блоке ${task.blockId} — результат потерян.`
    )
    return
  }
  const phrase = group.phrases.find((p) => p.id === task.phraseId)
  if (!phrase) {
    console.warn(`[build-items] applyTaskResult: не найдена фраза id="${task.phraseId}" в группе "${task.groupKey}" — результат потерян.`)
    return
  }
  Object.assign(phrase, patch)
}

export function markId3Written(lessonJson: LessonJson, task: GenerationTask): void {
  const block = lessonJson.blocks.find((b) => b.block_id === task.blockId)
  if (!block) {
    console.warn(`[build-items] markId3Written: не найден block_id="${task.blockId}" для задачи ${task.phraseId}.`)
    return
  }
  if (block.type === 'story') {
    block.id3_tags_written = true
    return
  }
  if (block.type === 'vocabulary') {
    const word = block.words.find((w) => w.id === task.phraseId)
    if (!word) {
      console.warn(`[build-items] markId3Written: не найдено слово id="${task.phraseId}" в блоке ${task.blockId}.`)
      return
    }
    word.id3_tags_written = true
    return
  }
  const group = block.groups.find((g) => g.key === task.groupKey)
  if (!group) {
    console.warn(`[build-items] markId3Written: не найдена группа key="${task.groupKey}" в блоке ${task.blockId}.`)
    return
  }
  const phrase = group.phrases.find((p) => p.id === task.phraseId)
  if (!phrase) {
    console.warn(`[build-items] markId3Written: не найдена фраза id="${task.phraseId}" в группе "${task.groupKey}".`)
    return
  }
  phrase.id3_tags_written = true
}
