import { mkdir, readFile, writeFile, rm, readdir, rename, stat, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import NodeID3 from 'node-id3'
import AdmZip from 'adm-zip'
import Ajv, { type AnySchema, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { LessonJson, PhraseJson, Provider } from '../types/lesson-json'

export class LessonJsonValidationError extends Error {
  constructor(
    message: string,
    readonly errors: unknown
  ) {
    super(message)
    this.name = 'LessonJsonValidationError'
  }
}

/**
 * Мульти-верификаторное ревью: shared/lesson.schema.json (см. комментарий у поля blocks) описывает
 * инвариант "в экспортированном ZIP все элементы должны быть done" ПРОЗОЙ — сам JSON Schema enum
 * (pending/generating/done/failed) допускает любой статус, так что ajv-валидация его не ловит.
 * Экспорт (ZIP для iOS, .apkg для Anki) частично сгенерированного урока даёт архив со ссылками на
 * несуществующие mp3-файлы. Оба вызывающих (cli/commands/export.ts, main/ipc-handlers.ts) должны
 * явно проверить это ПЕРЕД экспортом — вынесено сюда одним местом, чтобы не разойтись.
 */
export class LessonNotCompleteError extends Error {
  constructor(
    readonly topicId: string,
    readonly doneItems: number,
    readonly totalItems: number,
    readonly failedItems: number
  ) {
    super(
      `Урок «${topicId}» не полностью готов: ${doneItems}/${totalItems} done, ${failedItems} failed. ` +
        'Экспорт отменён — доозвучьте урок или используйте флаг для явного разрешения частичного экспорта.'
    )
    this.name = 'LessonNotCompleteError'
  }
}

export interface Id3TagsInput {
  /** Всегда ES-текст фразы, независимо от языка файла (см. docs/SPEC_COMBINE.md §5.3). */
  title: string
  /** Имя голоса, которым озвучен ИМЕННО этот файл. */
  artist: string
  /** title_ru урока. */
  album: string
  /** Всегда RU-текст фразы. */
  comment: string
  track?: string
}

export type LessonOverallStatus = 'done' | 'in_progress' | 'failed'

export interface LessonSummary {
  topicId: string
  topicNumber: number
  titleRu: string
  titleEs: string | null
  createdAt: string
  provider: Provider
  model: string
  voiceEs: string
  voiceRu: string
  phraseCount: number
  vocabCount: number
  storyCount: number
  estimatedCostUsd: number | null
  actualCostUsd: number | null
  sizeMb: number
  status: LessonOverallStatus
  doneItems: number
  totalItems: number
  failedItems: number
}

function assertSafeTopicId(topicId: string): void {
  // Совпадает с паттерном схемы (shared/lesson.schema.json topic_id) — заодно защита от directory traversal,
  // т.к. topicId используется напрямую как имя поддиректории.
  if (!/^[0-9]{2}-[a-z0-9-]+$/.test(topicId)) {
    throw new Error(`Небезопасный или некорректный topic_id: «${topicId}».`)
  }
}

let cachedValidator: ValidateFunction | null = null
let cachedSchemaPath: string | null = null

async function getValidator(schemaPath: string): Promise<ValidateFunction> {
  if (cachedValidator && cachedSchemaPath === schemaPath) return cachedValidator
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as AnySchema
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  cachedValidator = ajv.compile(schema)
  cachedSchemaPath = schemaPath
  return cachedValidator
}

function collectItems(lesson: LessonJson): PhraseJson[] {
  const items: PhraseJson[] = []
  for (const block of lesson.blocks) {
    if (block.type === 'vocabulary') items.push(...block.words)
    else if (block.type === 'story') {
      items.push({
        id: block.block_id,
        es: block.text_es,
        ru: block.text_ru,
        audio: block.audio,
        duration_ms: block.duration_ms,
        status: block.status
      })
    } else {
      for (const group of block.groups) items.push(...group.phrases)
    }
  }
  return items
}

/**
 * FileService — структура папок ~/lessons/<topic_id>/audio/{es,ru}/, запись/чтение lesson.json
 * (строго по shared/lesson.schema.json, ajv-валидация перед записью), ID3-теги, экспорт ZIP,
 * generation.log, листинг/удаление уроков для экрана «Библиотека».
 *
 * Чистый Node (fs/path) — работает и в Electron main, и в CLI без изменений.
 */
export class FileService {
  constructor(private readonly schemaPath: string) {}

  lessonDir(outputRoot: string, topicId: string): string {
    assertSafeTopicId(topicId)
    return join(outputRoot, topicId)
  }

  audioDir(outputRoot: string, topicId: string, lang: 'es' | 'ru'): string {
    return join(this.lessonDir(outputRoot, topicId), 'audio', lang)
  }

  async ensureLessonDirs(outputRoot: string, topicId: string): Promise<void> {
    await mkdir(this.audioDir(outputRoot, topicId, 'es'), { recursive: true })
    await mkdir(this.audioDir(outputRoot, topicId, 'ru'), { recursive: true })
  }

  async validateLessonJson(lesson: LessonJson): Promise<void> {
    const validate = await getValidator(this.schemaPath)
    const valid = validate(lesson)
    if (!valid) {
      throw new LessonJsonValidationError('lesson.json не проходит валидацию shared/lesson.schema.json', validate.errors)
    }
  }

  /**
   * Атомарная запись: пишем во временный файл в ТОЙ ЖЕ директории (гарантирует одну файловую
   * систему -> rename() атомарен по POSIX) и переименовываем поверх финального пути. Читатель
   * (readLessonJson, resume после падения процесса, экран библиотеки) никогда не увидит
   * частично записанный файл — либо старая версия целиком, либо новая целиком, без разрыва
   * посреди JSON. Без этого падение процесса ровно во время writeFile() оставляет битый
   * lesson.json, из которого невозможно резюмировать генерацию (см. §9 спеки, D-16).
   */
  async writeLessonJson(outputRoot: string, topicId: string, lesson: LessonJson): Promise<string> {
    await this.validateLessonJson(lesson)
    await this.ensureLessonDirs(outputRoot, topicId)
    const dir = this.lessonDir(outputRoot, topicId)
    const finalPath = join(dir, 'lesson.json')
    const tmpPath = join(dir, `.lesson.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const json = JSON.stringify(lesson, null, 2)
    try {
      await writeFile(tmpPath, json, 'utf8')
      await rename(tmpPath, finalPath)
    } catch (e) {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw e
    }
    return finalPath
  }

  async readLessonJson(outputRoot: string, topicId: string): Promise<LessonJson> {
    const path = join(this.lessonDir(outputRoot, topicId), 'lesson.json')
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as LessonJson
  }

  lessonJsonPath(outputRoot: string, topicId: string): string {
    return join(this.lessonDir(outputRoot, topicId), 'lesson.json')
  }

  /**
   * title=ES (всегда), artist=голос ЭТОГО файла, album=title_ru урока, comment=RU (всегда).
   *
   * ВНИМАНИЕ: несмотря на тип `Promise<boolean>` в .d.ts node-id3, установленная версия
   * `NodeID3.Promise.write()` в реальности резолвится в `undefined` при успехе (её внутренний
   * makePromise() оборачивает callback-версию, чей callback вызывается без второго аргумента) —
   * проверено эмпирически. Поэтому успех/неудача определяются ТОЛЬКО через resolve/reject,
   * а не через сравнение возвращаемого значения с true.
   */
  async writeId3Tags(filePath: string, tags: Id3TagsInput): Promise<void> {
    try {
      await NodeID3.Promise.write(
        {
          title: tags.title,
          artist: tags.artist,
          album: tags.album,
          comment: { language: 'rus', text: tags.comment },
          year: String(new Date().getFullYear()),
          genre: 'Language Learning',
          trackNumber: tags.track
        },
        filePath
      )
    } catch (e) {
      throw new Error(`Не удалось записать ID3-теги для ${filePath}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async appendGenerationLog(outputRoot: string, topicId: string, line: string): Promise<void> {
    const path = join(this.lessonDir(outputRoot, topicId), 'generation.log')
    const stamp = new Date().toISOString()
    await appendFile(path, `[${stamp}] ${line}\n`, 'utf8')
  }

  async lessonSizeMb(outputRoot: string, topicId: string): Promise<number> {
    const dir = this.lessonDir(outputRoot, topicId)
    let total = 0
    const walk = async (d: string): Promise<void> => {
      if (!existsSync(d)) return
      const entries = await readdir(d, { withFileTypes: true })
      for (const entry of entries) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) await walk(p)
        else total += (await stat(p)).size
      }
    }
    await walk(dir)
    return total / (1024 * 1024)
  }

  /** Экспорт ZIP для iOS: lesson.json + audio/** (см. docs/SPEC_COMBINE.md §7.2). */
  async exportZip(outputRoot: string, topicId: string, destZipPath: string): Promise<string> {
    const dir = this.lessonDir(outputRoot, topicId)
    const zip = new AdmZip()
    zip.addLocalFile(join(dir, 'lesson.json'))
    if (existsSync(join(dir, 'audio'))) {
      zip.addLocalFolder(join(dir, 'audio'), 'audio')
    }
    await mkdir(dirname(destZipPath), { recursive: true })
    await zip.writeZipPromise(destZipPath)
    return destZipPath
  }

  defaultZipPath(outputRoot: string, topicId: string): string {
    return join(outputRoot, `lesson-${topicId}.zip`)
  }

  summarize(lesson: LessonJson, sizeMb: number): LessonSummary {
    const items = collectItems(lesson)
    const done = items.filter((i) => i.status === 'done').length
    const failed = items.filter((i) => i.status === 'failed').length
    const status: LessonOverallStatus = failed > 0 ? 'failed' : done === items.length ? 'done' : 'in_progress'
    return {
      topicId: lesson.topic_id,
      topicNumber: lesson.topic_number,
      titleRu: lesson.title_ru,
      titleEs: lesson.title_es ?? null,
      createdAt: lesson.created_at,
      provider: lesson.config.provider,
      model: lesson.config.model,
      voiceEs: lesson.config.voice_es.name,
      voiceRu: lesson.config.voice_ru.name,
      phraseCount: lesson.stats.phrase_count,
      vocabCount: lesson.stats.vocab_count,
      storyCount: lesson.stats.story_count,
      estimatedCostUsd: lesson.stats.estimated_cost_usd ?? null,
      actualCostUsd: lesson.stats.actual_cost_usd ?? null,
      sizeMb,
      status,
      doneItems: done,
      totalItems: items.length,
      failedItems: failed
    }
  }

  /** Бросает LessonNotCompleteError, если хотя бы один элемент не done — см. класс-докстринг. */
  assertLessonComplete(lesson: LessonJson): void {
    const items = collectItems(lesson)
    const done = items.filter((i) => i.status === 'done').length
    const failed = items.filter((i) => i.status === 'failed').length
    if (failed > 0 || done < items.length) {
      throw new LessonNotCompleteError(lesson.topic_id, done, items.length, failed)
    }
  }

  async listLessons(outputRoot: string): Promise<LessonSummary[]> {
    if (!existsSync(outputRoot)) return []
    const entries = await readdir(outputRoot, { withFileTypes: true })
    const summaries: LessonSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const lessonJsonPath = join(outputRoot, entry.name, 'lesson.json')
      if (!existsSync(lessonJsonPath)) continue
      try {
        const lesson = JSON.parse(await readFile(lessonJsonPath, 'utf8')) as LessonJson
        const sizeMb = await this.lessonSizeMb(outputRoot, entry.name)
        summaries.push(this.summarize(lesson, sizeMb))
      } catch {
        // Повреждённый/незавершённый lesson.json — пропускаем, не валим весь список библиотеки.
      }
    }
    return summaries
  }

  async deleteLesson(outputRoot: string, topicId: string): Promise<void> {
    const dir = this.lessonDir(outputRoot, topicId)
    await rm(dir, { recursive: true, force: true })
  }

  async lessonExists(outputRoot: string, topicId: string): Promise<boolean> {
    return existsSync(this.lessonJsonPath(outputRoot, topicId))
  }
}
