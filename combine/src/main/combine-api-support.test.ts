import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileService } from '../core/file/file.service'
import { getSharedSchemaPath } from '../core/util/paths'
import type { LessonJson } from '../core/types/lesson-json'
import { buildLibraryEntries, deriveLibraryStatus, findAudioItem, readPhraseAudioDataUrl } from './combine-api-support'

function phraseLesson(overrides: Partial<LessonJson> = {}): LessonJson {
  return {
    schema_version: '1.0',
    topic_id: '09-test',
    topic_number: 9,
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
      phrase_count: 1,
      vocab_count: 1,
      story_count: 1,
      total_elements: 3,
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
        type: 'verb_group',
        title_ru: 'Глаголы',
        order_index: 0,
        groups: [
          {
            key: 'g1',
            title_ru: null,
            translation_ru: null,
            order_index: 0,
            phrases: [
              {
                id: 'p1',
                es: 'Hola.',
                ru: 'Привет.',
                audio: { es: 'audio/es/p1.mp3', ru: 'audio/ru/p1.mp3' },
                duration_ms: { es: 100, ru: 200 },
                status: 'done'
              }
            ]
          }
        ]
      },
      {
        block_id: 'b2',
        type: 'vocabulary',
        title_ru: 'Слова',
        order_index: 1,
        words: [
          {
            id: 'w1',
            es: 'el gato',
            ru: 'кот',
            audio: { es: 'audio/es/w1.mp3', ru: 'audio/ru/w1.mp3' },
            duration_ms: { es: 300, ru: 400 },
            status: 'done'
          }
        ]
      },
      {
        block_id: 'b3',
        type: 'story',
        title_ru: 'Рассказ',
        order_index: 2,
        text_es: 'Es.',
        text_ru: 'Ру.',
        audio: { es: 'audio/es/09-b3-story.mp3', ru: 'audio/ru/09-b3-story.mp3' },
        duration_ms: { es: 500, ru: 600 },
        status: 'done'
      }
    ],
    ...overrides
  }
}

describe('deriveLibraryStatus (соответствует renderer/adapters/mockAdapter.ts#deriveLibraryStatus)', () => {
  it('все элементы done -> done', () => {
    expect(deriveLibraryStatus(phraseLesson())).toBe('done')
  })

  it('все элементы failed -> failed', () => {
    const lesson = phraseLesson()
    for (const block of lesson.blocks) {
      if (block.type === 'vocabulary') for (const w of block.words) w.status = 'failed'
      else if (block.type === 'story') block.status = 'failed'
      else for (const g of block.groups) for (const p of g.phrases) p.status = 'failed'
    }
    expect(deriveLibraryStatus(lesson)).toBe('failed')
  })

  it('смешанные статусы -> in_progress', () => {
    const lesson = phraseLesson()
    if (lesson.blocks[1].type === 'vocabulary') lesson.blocks[1].words[0].status = 'failed'
    expect(deriveLibraryStatus(lesson)).toBe('in_progress')
  })

  it('ноль элементов (пустые блоки) -> empty', () => {
    const lesson = phraseLesson({
      blocks: [{ block_id: 'b1', type: 'vocabulary', title_ru: 'Слова', order_index: 0, words: [] }]
    })
    expect(deriveLibraryStatus(lesson)).toBe('empty')
  })
})

describe('findAudioItem — поиск по id фразы/слова/рассказа (storySlug)', () => {
  const lesson = phraseLesson()

  it('находит фразу внутри группы', () => {
    expect(findAudioItem(lesson, 'p1')).toEqual({ audio: { es: 'audio/es/p1.mp3', ru: 'audio/ru/p1.mp3' }, duration_ms: { es: 100, ru: 200 } })
  })

  it('находит слово словаря', () => {
    expect(findAudioItem(lesson, 'w1')).toEqual({ audio: { es: 'audio/es/w1.mp3', ru: 'audio/ru/w1.mp3' }, duration_ms: { es: 300, ru: 400 } })
  })

  it('находит рассказ по синтетическому id (storySlug)', () => {
    expect(findAudioItem(lesson, '09-b3-story')).toEqual({
      audio: { es: 'audio/es/09-b3-story.mp3', ru: 'audio/ru/09-b3-story.mp3' },
      duration_ms: { es: 500, ru: 600 }
    })
  })

  it('неизвестный id -> null', () => {
    expect(findAudioItem(lesson, 'nope')).toBeNull()
  })
})

describe('buildLibraryEntries / readPhraseAudioDataUrl — интеграция с реальным FileService на диске', () => {
  let workDir: string
  let outputRoot: string
  let fileService: FileService

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-api-support-'))
    outputRoot = join(workDir, 'lessons')
    await mkdir(outputRoot, { recursive: true })
    fileService = new FileService(getSharedSchemaPath())
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function writeRawLesson(topicId: string, lesson: LessonJson): Promise<void> {
    const dir = join(outputRoot, topicId)
    await mkdir(dir, { recursive: true })
    // Пишем сырой JSON напрямую (в обход FileService.writeLessonJson) — эти функции работают только
    // на чтение (readLessonJson не валидирует по ajv-схеме, см. FileService), так тесту не нужно
    // собирать полностью валидный по shared/lesson.schema.json урок (напр. blocks.minItems больше не
    // мешает проверить кейс "0 элементов" — см. deriveLibraryStatus выше).
    await writeFile(join(dir, 'lesson.json'), JSON.stringify(lesson), 'utf8')
  }

  it('собирает LibraryEntry[] с полным LessonJson и производным статусом, пропуская битые lesson.json и не-папки', async () => {
    const done = phraseLesson({ topic_id: '01-done' })
    await writeRawLesson('01-done', done)

    const failed = phraseLesson({ topic_id: '02-failed' })
    for (const block of failed.blocks) {
      if (block.type === 'vocabulary') for (const w of block.words) w.status = 'failed'
      else if (block.type === 'story') block.status = 'failed'
      else for (const g of block.groups) for (const p of g.phrases) p.status = 'failed'
    }
    await writeRawLesson('02-failed', failed)

    // Битый lesson.json — должен быть молча пропущен, а не валить весь список.
    await mkdir(join(outputRoot, '03-broken'), { recursive: true })
    await writeFile(join(outputRoot, '03-broken', 'lesson.json'), '{ не валидный json', 'utf8')

    // Файл (не папка) в outputRoot — должен быть проигнорирован.
    await writeFile(join(outputRoot, 'notes.txt'), 'stray file', 'utf8')

    const entries = await buildLibraryEntries(outputRoot, fileService)
    expect(entries).toHaveLength(2)

    const byId = new Map(entries.map((e) => [e.lesson.topic_id, e]))
    expect(byId.get('01-done')?.status).toBe('done')
    expect(byId.get('02-failed')?.status).toBe('failed')
    for (const e of entries) {
      // lesson.json без аудио — считанные единицы КБ, что легитимно округляется до 0.00 МБ
      // (Math.round(x*100)/100, см. buildLibraryEntries) — проверяем валидность числа, не точность.
      expect(e.sizeMb).not.toBeNull()
      expect(e.sizeMb as number).toBeGreaterThanOrEqual(0)
    }
  })

  it('пустая/несуществующая outputRoot -> []', async () => {
    expect(await buildLibraryEntries(join(workDir, 'does-not-exist'), fileService)).toEqual([])
  })

  it('readPhraseAudioDataUrl читает реальные байты mp3 и кодирует как data: URI (audio/mpeg)', async () => {
    const lesson = phraseLesson({ topic_id: '04-audio' })
    await writeRawLesson('04-audio', lesson)
    const esBytes = Buffer.from('ES-AUDIO-BYTES')
    const ruBytes = Buffer.from('RU-AUDIO-BYTES-LONGER')
    await mkdir(join(outputRoot, '04-audio', 'audio', 'es'), { recursive: true })
    await mkdir(join(outputRoot, '04-audio', 'audio', 'ru'), { recursive: true })
    await writeFile(join(outputRoot, '04-audio', 'audio', 'es', 'w1.mp3'), esBytes)
    await writeFile(join(outputRoot, '04-audio', 'audio', 'ru', 'w1.mp3'), ruBytes)

    const es = await readPhraseAudioDataUrl(fileService, outputRoot, '04-audio', 'w1', 'es')
    expect(es.durationMs).toBe(300)
    expect(es.audioDataUrl.startsWith('data:audio/mpeg;base64,')).toBe(true)
    const esDecoded = Buffer.from(es.audioDataUrl.slice('data:audio/mpeg;base64,'.length), 'base64')
    expect(esDecoded.equals(esBytes)).toBe(true)

    const ru = await readPhraseAudioDataUrl(fileService, outputRoot, '04-audio', 'w1', 'ru')
    expect(ru.durationMs).toBe(400)
    const ruDecoded = Buffer.from(ru.audioDataUrl.slice('data:audio/mpeg;base64,'.length), 'base64')
    expect(ruDecoded.equals(ruBytes)).toBe(true)
  })

  it('readPhraseAudioDataUrl бросает для неизвестного phraseId', async () => {
    const lesson = phraseLesson({ topic_id: '05-missing' })
    await writeRawLesson('05-missing', lesson)
    await expect(readPhraseAudioDataUrl(fileService, outputRoot, '05-missing', 'nope', 'es')).rejects.toThrow(/не найдена/)
  })
})
