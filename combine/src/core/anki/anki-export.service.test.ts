import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import type { LessonJson } from '../types/lesson-json'
import { buildAnkiPackage, exportLessonToAnki } from './anki-export.service'

// Тот же паттерн, что core/util/paths.ts#getSharedSchemaPath() — резолвим относительно СВОЕГО
// расположения (src/core/anki/), а не process.cwd(), чтобы тест был устойчив к тому, откуда его
// запускают (vitest из combine/, npm run test и т.п. — всегда одна и та же глубина вложенности).
const FIXTURE_ZIP = fileURLToPath(new URL('../../../../shared/fixtures/lesson-04-hablar-de-mi-mismo.zip', import.meta.url))

describe('anki-export.service — экспорт урока в .apkg (v1.1, без нативных зависимостей — sql.js)', () => {
  let workDir: string
  let lessonDir: string
  let lesson: LessonJson

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-anki-export-'))
    lessonDir = join(workDir, 'lesson')
    new AdmZip(FIXTURE_ZIP).extractAllTo(lessonDir, true)
    lesson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8')) as LessonJson
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('buildAnkiPackage: story пропускается — 13 карточек (9 фраз + 4 слова), 26 media-файлов (13×2)', async () => {
    const { apkgBuffer, noteCount, mediaCount } = await buildAnkiPackage(lesson, lessonDir)
    expect(lesson.stats.phrase_count).toBe(9)
    expect(lesson.stats.vocab_count).toBe(4)
    expect(lesson.stats.story_count).toBe(1)
    expect(noteCount).toBe(13)
    expect(mediaCount).toBe(26)
    expect(apkgBuffer.length).toBeGreaterThan(0)
  })

  it('exportLessonToAnki: .apkg существует, это валидный ZIP с collection.anki2 (SQLite magic) и media-манифестом', async () => {
    const destApkg = join(workDir, 'out', 'lesson-04.apkg')
    const result = await exportLessonToAnki(lesson, lessonDir, destApkg)

    expect(result.apkgPath).toBe(destApkg)
    expect(result.noteCount).toBe(13)
    expect(result.mediaCount).toBe(26)
    expect(existsSync(destApkg)).toBe(true)
    expect(statSync(destApkg).size).toBeGreaterThan(0)

    // Валидный ZIP: AdmZip должен суметь его открыть и перечислить записи без исключений.
    const zip = new AdmZip(destApkg)
    const entries = zip.getEntries()
    const names = entries.map((e) => e.entryName)
    expect(names).toContain('collection.anki2')
    expect(names).toContain('media')

    // collection.anki2 — настоящий SQLite-файл (магические байты заголовка формата).
    const sqliteEntry = zip.getEntry('collection.anki2')
    expect(sqliteEntry).not.toBeNull()
    const sqliteBytes = sqliteEntry!.getData()
    expect(sqliteBytes.subarray(0, 15).toString('utf8')).toBe('SQLite format 3')

    // media-манифест: 26 файлов (13 элементов × ES+RU), ключи — числовые индексы записей в архиве.
    const mediaEntry = zip.getEntry('media')
    const manifest = JSON.parse(mediaEntry!.getData().toString('utf8')) as Record<string, string>
    const manifestKeys = Object.keys(manifest)
    expect(manifestKeys).toHaveLength(26)
    for (const key of manifestKeys) {
      expect(names).toContain(key) // каждый ключ манифеста — реальная запись в zip (сами байты файла)
      expect(manifest[key]).toMatch(/^(es|ru)_.*\.mp3$/)
    }
    // Все имена файлов в манифесте уникальны (не коллизия es/ru одного id — см. es_/ru_ префиксы).
    expect(new Set(Object.values(manifest)).size).toBe(26)
  })

  it('note fields содержат ES/RU текст и корректные [sound:...] теги (Front=ES, Back=RU)', async () => {
    // Читаем через ту же sql.js — самый надёжный способ проверить содержимое notes.flds без
    // завязки на внутренний формат файла: открываем экспортированный collection.anki2 заново.
    const initSqlJs = (await import('sql.js')).default
    const { apkgBuffer } = await buildAnkiPackage(lesson, lessonDir)
    const zip = new AdmZip(apkgBuffer)
    const sqliteBytes = zip.getEntry('collection.anki2')!.getData()

    const SQL = await initSqlJs()
    const db = new SQL.Database(sqliteBytes)
    const res = db.exec('SELECT flds, sfld FROM notes ORDER BY id')
    db.close()

    expect(res).toHaveLength(1)
    const rows = res[0].values
    expect(rows).toHaveLength(13)
    for (const row of rows) {
      const flds = String(row[0])
      const [front, back] = flds.split('\x1f')
      expect(front).toMatch(/\[sound:es_.*\.mp3\]/)
      expect(back).toMatch(/\[sound:ru_.*\.mp3\]/)
    }
  })

  it('колода названа title_ru урока', async () => {
    const initSqlJs = (await import('sql.js')).default
    const { apkgBuffer } = await buildAnkiPackage(lesson, lessonDir)
    const zip = new AdmZip(apkgBuffer)
    const sqliteBytes = zip.getEntry('collection.anki2')!.getData()

    const SQL = await initSqlJs()
    const db = new SQL.Database(sqliteBytes)
    const res = db.exec('SELECT decks FROM col')
    db.close()

    const decks = JSON.parse(String(res[0].values[0][0])) as Record<string, { name: string }>
    const deckNames = Object.values(decks).map((d) => d.name)
    expect(deckNames).toContain(lesson.title_ru)
  })
})
