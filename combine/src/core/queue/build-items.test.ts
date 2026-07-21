import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { ItemStatus, LessonJson } from '../types/lesson-json'
import { flattenToTasks, type SessionVoices } from './build-items'

const VOICES: SessionVoices = { es: { id: 'Mónica', name: 'Mónica' }, ru: { id: 'Milena', name: 'Milena' } }

function lessonWithAudioPaths(audioEs: string, audioRu: string, status: ItemStatus = 'pending'): LessonJson {
  return {
    schema_version: '1.0',
    topic_id: '07-traversal-test',
    topic_number: 7,
    title_ru: 'Тест',
    title_es: null,
    created_at: new Date().toISOString(),
    generator_version: '1.0.0',
    config: {
      provider: 'mock_say',
      model: 'macos_say',
      voice_es: { id: 'Mónica', name: 'Mónica' },
      voice_ru: { id: 'Milena', name: 'Milena' },
      stability: null,
      similarity_boost: null,
      seed: null
    },
    stats: {
      phrase_count: 0,
      vocab_count: 1,
      story_count: 0,
      total_elements: 1,
      characters_es: 10,
      characters_ru: 10,
      total_characters: 20,
      estimated_cost_usd: 0,
      actual_cost_usd: 0,
      generation_duration_seconds: null,
      file_size_mb: null
    },
    blocks: [
      {
        block_id: 'b1',
        type: 'vocabulary',
        title_ru: 'Слова',
        order_index: 0,
        words: [
          {
            id: 'w1',
            es: 'el gato',
            ru: 'кот',
            audio: { es: audioEs, ru: audioRu },
            duration_ms: { es: 0, ru: 0 },
            status
          }
        ]
      }
    ]
  }
}

/**
 * Мульти-верификаторное ревью — та же категория, что combine-api-support.ts:108/
 * anki-export.service.ts:293 (path traversal через audio.es/audio.ru из lesson.json), найдена
 * дополнительно при фикс-проходе по остальным чтениям audio.*: flattenToTasks() строит
 * esOutPath/ruOutPath, КУДА generation-queue.ts (resume существующего урока — lessonJson читается
 * с диска) запишет mkdir(recursive)+writeFile() синтезированные байты. Без resolveWithinDir() это
 * была бы ЗАПИСЬ произвольного файла на диск (более серьёзно, чем чтение в двух местах,
 * упомянутых ревью буквально), если бы audio.es/audio.ru когда-либо содержали "../../...".
 */
describe('flattenToTasks — resolveWithinDir защищает esOutPath/ruOutPath от directory traversal', () => {
  it('обычный audio.es/audio.ru -> esOutPath/ruOutPath строятся нормально внутри audioRoot', () => {
    const lesson = lessonWithAudioPaths('audio/es/w1.mp3', 'audio/ru/w1.mp3')
    const tasks = flattenToTasks(lesson, '/lessons/07-traversal-test', VOICES)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].esOutPath).toBe(join('/lessons/07-traversal-test', 'audio', 'es', 'w1.mp3'))
    expect(tasks[0].ruOutPath).toBe(join('/lessons/07-traversal-test', 'audio', 'ru', 'w1.mp3'))
  })

  it('РЕГРЕССИЯ: audio.es с "../../" вне audioRoot (напр. resume вручную отредактированного lesson.json) -> бросает, не строит путь для записи вне папки урока', () => {
    const lesson = lessonWithAudioPaths('../../../../../../etc/cron.d/evil', 'audio/ru/w1.mp3')
    expect(() => flattenToTasks(lesson, '/lessons/07-traversal-test', VOICES)).toThrow(/выходит за пределы/)
  })

  it('РЕГРЕССИЯ: то же самое для audio.ru', () => {
    const lesson = lessonWithAudioPaths('audio/es/w1.mp3', '../../../../../../etc/cron.d/evil')
    expect(() => flattenToTasks(lesson, '/lessons/07-traversal-test', VOICES)).toThrow(/выходит за пределы/)
  })

  it('done-элементы по-прежнему исключаются из задач (идемпотентность resume) — traversal-проверка не задевает уже готовые', () => {
    // status='done' -> pushTask возвращается РАНЬШЕ resolveWithinDir(), так что даже гипотетически
    // "грязный" путь у уже готового элемента не мешает resume остальных (см. docstring pushTask).
    const lesson = lessonWithAudioPaths('../../../../etc/whatever', 'audio/ru/w1.mp3', 'done')
    const tasks = flattenToTasks(lesson, '/lessons/07-traversal-test', VOICES)
    expect(tasks).toHaveLength(0)
  })
})
