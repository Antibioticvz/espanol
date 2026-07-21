/**
 * Типы, зеркалящие shared/lesson.schema.json — контракт lesson.json между
 * Combine (генератор) и Audio Learner (iOS). Источник истины — сама JSON Schema
 * (см. docs/DECISIONS.md D-11); при расхождении приоритет у неё.
 *
 * Этот модуль не содержит рантайм-кода с зависимостями Node/Electron — его можно
 * безопасно импортировать и из renderer (только типы, стираются при компиляции).
 */

export type Provider = 'elevenlabs' | 'mock_say'
export type BlockType = 'verb_group' | 'phrase_group' | 'vocabulary' | 'story'
export type ItemStatus = 'pending' | 'generating' | 'done' | 'failed'

export interface VoiceRef {
  id: string
  name: string
}

export interface AudioPair {
  es: string
  ru: string
}

export interface DurationPair {
  es: number
  ru: number
}

export interface PhraseJson {
  id: string
  es: string
  ru: string
  audio: AudioPair
  duration_ms: DurationPair
  status: ItemStatus
  id3_tags_written?: boolean
  generated_at?: string | null
  error?: string | null
}

export interface GroupJson {
  key: string
  title_ru?: string | null
  translation_ru?: string | null
  order_index: number
  phrases: PhraseJson[]
}

export interface BlockGroupsJson {
  block_id: string
  type: 'verb_group' | 'phrase_group'
  title_ru: string
  title_es?: string | null
  order_index: number
  groups: GroupJson[]
}

export interface BlockVocabularyJson {
  block_id: string
  type: 'vocabulary'
  title_ru: string
  title_es?: string | null
  order_index: number
  words: PhraseJson[]
}

export interface BlockStoryJson {
  block_id: string
  type: 'story'
  title_ru: string
  title_es?: string | null
  order_index: number
  text_es: string
  text_ru: string
  audio: AudioPair
  duration_ms: DurationPair
  status: ItemStatus
  split_by_phrase?: boolean
  id3_tags_written?: boolean
  generated_at?: string | null
  error?: string | null
}

export type BlockJson = BlockGroupsJson | BlockVocabularyJson | BlockStoryJson

export interface LessonConfigJson {
  provider: Provider
  model: string
  voice_es: VoiceRef
  voice_ru: VoiceRef
  stability?: number | null
  similarity_boost?: number | null
  seed?: number | null
}

export interface LessonStatsJson {
  phrase_count: number
  vocab_count: number
  story_count: number
  total_elements: number
  characters_es: number
  characters_ru: number
  total_characters: number
  estimated_cost_usd?: number | null
  actual_cost_usd?: number | null
  generation_duration_seconds?: number | null
  file_size_mb?: number | null
}

export interface LessonJson {
  schema_version: string
  topic_id: string
  topic_number: number
  title_ru: string
  title_es?: string | null
  created_at: string
  generator_version: string
  config: LessonConfigJson
  stats: LessonStatsJson
  blocks: BlockJson[]
}

export const SCHEMA_VERSION = '1.0'
export const GENERATOR_VERSION = '1.0.0'
