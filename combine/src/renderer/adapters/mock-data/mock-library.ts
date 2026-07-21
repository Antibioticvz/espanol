/** Начальное состояние "библиотеки" для mockAdapter — 2 готовых урока + 1 "в процессе" (см. docs/SPEC_COMBINE.md §4.4). */

import type { LibraryEntry } from '../../../shared/ipc'
import { SAMPLE_TOPIC_02_RAW, SAMPLE_TOPIC_03_RAW, SAMPLE_TOPIC_04_RAW } from '../../lib/sample-texts'
import { allDone, buildMockLessonJson, partialProgress } from './build-lesson'
import { ELEVENLABS_MOCK_VOICES } from './mock-voices'
import { parseLessonText } from './mock-parser'

function parseOrThrow(raw: string, label: string) {
  const result = parseLessonText(raw)
  if (!result.lesson) {
    throw new Error(`Мок-данные "${label}" не распарсились: ${result.errors.map((e) => e.message).join('; ')}`)
  }
  return result.lesson
}

// Библиотека представляет завершённые ElevenLabs-генерации (см. common.provider ниже) — голоса
// берём из ElevenLabs-флейвора списка, а не из MOCK_SAY_VOICES (Mónica/Milena — те для mock_say).
const voiceEs = { id: ELEVENLABS_MOCK_VOICES[0].id, name: ELEVENLABS_MOCK_VOICES[0].name } // Pablo
const voiceRu = { id: ELEVENLABS_MOCK_VOICES[4].id, name: ELEVENLABS_MOCK_VOICES[4].name } // Masha

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

export function createMockLibrary(): LibraryEntry[] {
  const lesson04 = parseOrThrow(SAMPLE_TOPIC_04_RAW, 'topic-04')
  const lesson03 = parseOrThrow(SAMPLE_TOPIC_03_RAW, 'topic-03')
  const lesson02 = parseOrThrow(SAMPLE_TOPIC_02_RAW, 'topic-02')

  const common = {
    provider: 'elevenlabs' as const,
    model: 'eleven_multilingual_v2',
    voiceEs,
    voiceRu,
    stability: 0.5,
    similarityBoost: 0.75,
    seed: null,
    pricePerThousandChars: 0.1
  }

  const entry04 = buildMockLessonJson(lesson04, {
    ...common,
    createdAt: daysAgo(1),
    statusForIndex: allDone
  })

  const entry03 = buildMockLessonJson(lesson03, {
    ...common,
    createdAt: daysAgo(2),
    statusForIndex: allDone
  })

  const entry02 = buildMockLessonJson(lesson02, {
    ...common,
    createdAt: daysAgo(0),
    statusForIndex: partialProgress(0.5, 0.06)
  })

  return [
    { lesson: entry02, status: 'in_progress', sizeMb: entry02.stats.file_size_mb ?? null },
    { lesson: entry04, status: 'done', sizeMb: entry04.stats.file_size_mb ?? null },
    { lesson: entry03, status: 'done', sizeMb: entry03.stats.file_size_mb ?? null }
  ]
}
