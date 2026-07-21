import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import NodeID3 from 'node-id3'
import AdmZip from 'adm-zip'
import type { LessonJson } from '../types/lesson-json'
import { FileService, LessonJsonValidationError } from './file.service'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = resolve(__dirname, '../../../../shared/lesson.schema.json')

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8])

function validLesson(overrides: Partial<LessonJson> = {}): LessonJson {
  return {
    schema_version: '1.0',
    topic_id: '01-test-lesson',
    topic_number: 1,
    title_ru: 'Тестовый урок',
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
      characters_es: 6,
      characters_ru: 3,
      total_characters: 9,
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
        title_es: null,
        order_index: 0,
        words: [
          {
            id: '01-b1-vocab-01',
            es: 'el gato',
            ru: 'кот',
            audio: { es: 'audio/es/01-b1-vocab-01.mp3', ru: 'audio/ru/01-b1-vocab-01.mp3' },
            duration_ms: { es: 500, ru: 400 },
            status: 'done',
            id3_tags_written: true,
            generated_at: new Date().toISOString(),
            error: null
          }
        ]
      }
    ],
    ...overrides
  }
}

describe('FileService', () => {
  let outputRoot: string
  let service: FileService

  beforeEach(async () => {
    outputRoot = await mkdtemp(join(tmpdir(), 'combine-fileservice-'))
    service = new FileService(SCHEMA_PATH)
  })

  afterEach(async () => {
    await rm(outputRoot, { recursive: true, force: true })
  })

  it('создаёт структуру ~/<out>/<topic_id>/audio/{es,ru}/', async () => {
    await service.ensureLessonDirs(outputRoot, '01-test-lesson')
    expect(existsSync(service.audioDir(outputRoot, '01-test-lesson', 'es'))).toBe(true)
    expect(existsSync(service.audioDir(outputRoot, '01-test-lesson', 'ru'))).toBe(true)
  })

  it('пишет валидный (по shared/lesson.schema.json) lesson.json и читает его обратно', async () => {
    const lesson = validLesson()
    const path = await service.writeLessonJson(outputRoot, lesson.topic_id, lesson)
    expect(existsSync(path)).toBe(true)
    const readBack = await service.readLessonJson(outputRoot, lesson.topic_id)
    expect(readBack).toEqual(lesson)
  })

  it('отклоняет невалидный lesson.json с LessonJsonValidationError', async () => {
    // additionalProperties:false на верхнем уровне -> лишнее поле обязано провалить схему
    const invalid = { ...validLesson(), extra_field_not_in_schema: true } as unknown as LessonJson
    await expect(service.writeLessonJson(outputRoot, '01-test-lesson', invalid)).rejects.toBeInstanceOf(
      LessonJsonValidationError
    )
  })

  it('отклоняет lesson.json с некорректным topic_id (нарушение паттерна схемы)', async () => {
    const invalid = validLesson({ topic_id: 'НЕ_ПРАВИЛЬНЫЙ id!' })
    await expect(service.writeLessonJson(outputRoot, '01-test-lesson', invalid)).rejects.toBeInstanceOf(
      LessonJsonValidationError
    )
  })

  it('пишет и читает ID3-теги (title=ES, artist=голос файла, album=title_ru, comment=RU)', async () => {
    const filePath = join(outputRoot, 'phrase.mp3')
    await writeFile(filePath, FAKE_MP3)
    await service.writeId3Tags(filePath, {
      title: 'Me llamo Victor.',
      artist: 'Mónica',
      album: 'Рассказ о себе',
      comment: 'Меня зовут Виктор.',
      track: '04-b1-llamarse-01'
    })
    const tags = await NodeID3.Promise.read(filePath)
    expect(tags.title).toBe('Me llamo Victor.')
    expect(tags.artist).toBe('Mónica')
    expect(tags.album).toBe('Рассказ о себе')
    expect(tags.comment?.text).toBe('Меня зовут Виктор.')
  })

  it('generation.log — дописывает строки с таймстампом', async () => {
    await service.ensureLessonDirs(outputRoot, '01-test-lesson')
    await service.appendGenerationLog(outputRoot, '01-test-lesson', 'первая строка')
    await service.appendGenerationLog(outputRoot, '01-test-lesson', 'вторая строка')
    const logPath = join(service.lessonDir(outputRoot, '01-test-lesson'), 'generation.log')
    const content = await readFile(logPath, 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('первая строка')
    expect(lines[1]).toContain('вторая строка')
  })

  it('экспортирует ZIP, который распаковывается обратно с lesson.json и mp3', async () => {
    const lesson = validLesson()
    await service.writeLessonJson(outputRoot, lesson.topic_id, lesson)
    await mkdir(service.audioDir(outputRoot, lesson.topic_id, 'es'), { recursive: true })
    await mkdir(service.audioDir(outputRoot, lesson.topic_id, 'ru'), { recursive: true })
    await writeFile(join(service.audioDir(outputRoot, lesson.topic_id, 'es'), '01-b1-vocab-01.mp3'), FAKE_MP3)
    await writeFile(join(service.audioDir(outputRoot, lesson.topic_id, 'ru'), '01-b1-vocab-01.mp3'), FAKE_MP3)

    const zipPath = service.defaultZipPath(outputRoot, lesson.topic_id)
    await service.exportZip(outputRoot, lesson.topic_id, zipPath)
    expect(existsSync(zipPath)).toBe(true)

    const extractDir = await mkdtemp(join(tmpdir(), 'combine-unzip-'))
    try {
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(extractDir, true)
      expect(existsSync(join(extractDir, 'lesson.json'))).toBe(true)
      expect(existsSync(join(extractDir, 'audio', 'es', '01-b1-vocab-01.mp3'))).toBe(true)
      expect(existsSync(join(extractDir, 'audio', 'ru', '01-b1-vocab-01.mp3'))).toBe(true)
      const extractedLesson = JSON.parse(await readFile(join(extractDir, 'lesson.json'), 'utf8'))
      expect(extractedLesson.topic_id).toBe(lesson.topic_id)
      const extractedMp3 = await readFile(join(extractDir, 'audio', 'es', '01-b1-vocab-01.mp3'))
      expect(extractedMp3.equals(FAKE_MP3)).toBe(true)
    } finally {
      await rm(extractDir, { recursive: true, force: true })
    }
  })

  it('listLessons классифицирует статус (done/in_progress/failed) и считает размер на диске', async () => {
    const doneLesson = validLesson({ topic_id: '01-done-lesson' })
    await service.writeLessonJson(outputRoot, doneLesson.topic_id, doneLesson)
    await mkdir(service.audioDir(outputRoot, doneLesson.topic_id, 'es'), { recursive: true })
    await writeFile(join(service.audioDir(outputRoot, doneLesson.topic_id, 'es'), '01-b1-vocab-01.mp3'), FAKE_MP3)

    const failedLesson = validLesson({
      topic_id: '02-failed-lesson',
      blocks: [
        {
          block_id: 'b1',
          type: 'vocabulary',
          title_ru: 'Слова',
          title_es: null,
          order_index: 0,
          words: [
            {
              id: '02-b1-vocab-01',
              es: 'x',
              ru: 'y',
              audio: { es: 'audio/es/02-b1-vocab-01.mp3', ru: 'audio/ru/02-b1-vocab-01.mp3' },
              duration_ms: { es: 0, ru: 0 },
              status: 'failed',
              error: 'сеть недоступна'
            }
          ]
        }
      ]
    })
    await service.writeLessonJson(outputRoot, failedLesson.topic_id, failedLesson)

    const summaries = await service.listLessons(outputRoot)
    expect(summaries).toHaveLength(2)
    const done = summaries.find((s) => s.topicId === '01-done-lesson')
    const failed = summaries.find((s) => s.topicId === '02-failed-lesson')
    expect(done?.status).toBe('done')
    expect(done?.sizeMb).toBeGreaterThan(0)
    expect(failed?.status).toBe('failed')
    expect(failed?.failedItems).toBe(1)
  })

  it('deleteLesson удаляет папку урока целиком', async () => {
    const lesson = validLesson()
    await service.writeLessonJson(outputRoot, lesson.topic_id, lesson)
    expect(await service.lessonExists(outputRoot, lesson.topic_id)).toBe(true)
    await service.deleteLesson(outputRoot, lesson.topic_id)
    expect(await service.lessonExists(outputRoot, lesson.topic_id)).toBe(false)
  })

  it('защита от directory traversal — некорректный topic_id отклоняется до любых fs-операций', () => {
    expect(() => service.lessonDir(outputRoot, '../../etc')).toThrow()
    expect(() => service.lessonDir(outputRoot, '01-ok/../../../etc')).toThrow()
  })

  it('РЕГРЕССИЯ: writeLessonJson атомарна — много конкурентных записей не оставляют битый JSON и не оставляют временных файлов', async () => {
    const base = validLesson()
    // 20 конкурентных записей той же фразы с разным title_ru — имитирует несколько progress-событий
    // GenerationQueue, персистящихся "одновременно" (fire-and-forget) без сериализации на вызывающей стороне.
    const writes = Array.from({ length: 20 }, (_, i) =>
      service.writeLessonJson(outputRoot, base.topic_id, { ...base, title_ru: `Версия ${i}` })
    )
    await Promise.all(writes)

    const raw = await readFile(service.lessonJsonPath(outputRoot, base.topic_id), 'utf8')
    // Файл должен быть ПОЛНОСТЬЮ валидным JSON (не обрублен посреди записи) — если бы запись была
    // не атомарной, конкурентные writeFile() в один и тот же путь могли бы перемежать байты двух
    // разных сериализаций и дать невалидный JSON.
    const parsed = JSON.parse(raw) as LessonJson
    expect(parsed.title_ru).toMatch(/^Версия \d+$/)

    // Никаких недоубранных .lesson.json.tmp-* после завершения всех записей.
    const dirEntries = await readdir(service.lessonDir(outputRoot, base.topic_id))
    expect(dirEntries.filter((f) => f.includes('.tmp-'))).toEqual([])
  })
})
