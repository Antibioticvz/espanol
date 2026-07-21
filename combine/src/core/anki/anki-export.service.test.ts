import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import type { LessonJson, PhraseJson } from '../types/lesson-json'
import { buildAnkiPackage, exportLessonToAnki } from './anki-export.service'

/** Находит фразу/слово фикстуры по id и возвращает ССЫЛКУ на объект (мутация видна в lesson). */
function findPhraseRef(lesson: LessonJson, id: string): PhraseJson {
  for (const block of lesson.blocks) {
    if (block.type === 'vocabulary') {
      const w = block.words.find((x) => x.id === id)
      if (w) return w
    } else if (block.type !== 'story') {
      for (const g of block.groups) {
        const p = g.phrases.find((x) => x.id === id)
        if (p) return p
      }
    }
  }
  throw new Error(`Фраза/слово не найдено в фикстуре: ${id}`)
}

/** Открывает notes-таблицу свежесобранного .apkg через sql.js — тот же паттерн, что и тесты ниже по файлу. */
async function readNotesTable(apkgBuffer: Buffer): Promise<Array<{ flds: string; guid: string }>> {
  const initSqlJs = (await import('sql.js')).default
  const zip = new AdmZip(apkgBuffer)
  const sqliteBytes = zip.getEntry('collection.anki2')!.getData()
  const SQL = await initSqlJs()
  const db = new SQL.Database(sqliteBytes)
  const res = db.exec('SELECT flds, guid FROM notes ORDER BY id')
  db.close()
  if (res.length === 0) return []
  return res[0].values.map((row) => ({ flds: String(row[0]), guid: String(row[1]) }))
}

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

/**
 * Мульти-верификаторное ревью (confirmed, anki-export.service.ts:47): раньше собирались ВСЕ
 * фразы/слова независимо от status — экспорт частично сгенерированного урока либо падал на
 * readFile недостающего mp3, либо (если файл случайно остался от предыдущей попытки) давал
 * карточку с устаревшим/чужим аудио. Регрессия: элемент со status='pending' И заведомо
 * несуществующим audio.es не должен даже попытаться быть прочитан.
 */
describe('РЕГРЕССИЯ: collectAnkiItems фильтрует по status="done" (anki-export.service.ts:47)', () => {
  let workDir: string
  let lessonDir: string
  let lesson: LessonJson

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-anki-export-status-'))
    lessonDir = join(workDir, 'lesson')
    new AdmZip(FIXTURE_ZIP).extractAllTo(lessonDir, true)
    lesson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8')) as LessonJson
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('pending-элемент с несуществующим audio.es пропускается без ошибки, не попадает в noteCount', async () => {
    const pending = findPhraseRef(lesson, '04-b1-llamarse-01')
    pending.status = 'pending'
    pending.audio = { es: 'audio/es/NOT-GENERATED-YET.mp3', ru: 'audio/ru/NOT-GENERATED-YET.mp3' }

    const { noteCount, mediaCount } = await buildAnkiPackage(lesson, lessonDir)
    expect(noteCount).toBe(12) // 13 - 1 pending
    expect(mediaCount).toBe(24) // 12 × 2
  })

  it('failed-элемент тоже пропускается', async () => {
    const failed = findPhraseRef(lesson, '04-b3-vocab-01')
    failed.status = 'failed'
    failed.audio = { es: 'audio/es/NOT-GENERATED-YET.mp3', ru: 'audio/ru/NOT-GENERATED-YET.mp3' }

    const { noteCount } = await buildAnkiPackage(lesson, lessonDir)
    expect(noteCount).toBe(12)
  })

  it('без фикса (для контраста): done-элементы по-прежнему все попадают, если ничего не менять', async () => {
    const { noteCount } = await buildAnkiPackage(lesson, lessonDir)
    expect(noteCount).toBe(13)
  })
})

/**
 * Мульти-верификаторное ревью (contested -> решено чинить, anki-export.service.ts:273):
 * item.es/item.ru — произвольный текст, ранее подставлявшийся в Front/Back без экранирования.
 */
describe('РЕГРЕССИЯ: экранирование HTML в Front/Back (anki-export.service.ts:273)', () => {
  let workDir: string
  let lessonDir: string
  let lesson: LessonJson

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-anki-export-escape-'))
    lessonDir = join(workDir, 'lesson')
    new AdmZip(FIXTURE_ZIP).extractAllTo(lessonDir, true)
    lesson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8')) as LessonJson
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('спецсимволы <, >, & в тексте фразы экранируются, [sound:...] и <br> остаются настоящей разметкой', async () => {
    const phrase = findPhraseRef(lesson, '04-b1-llamarse-01')
    phrase.es = 'A < B & C > D'
    phrase.ru = 'X & Y <тест>'

    const { apkgBuffer } = await buildAnkiPackage(lesson, lessonDir)
    const notes = await readNotesTable(apkgBuffer)
    const withEsText = notes.find((n) => n.flds.includes('&lt; B &amp; C &gt; D'))
    expect(withEsText).toBeDefined()
    const [front, back] = withEsText!.flds.split('\x1f')

    // Экранировано:
    expect(front).toContain('A &lt; B &amp; C &gt; D')
    expect(front).not.toContain('A < B & C > D')
    expect(back).toContain('X &amp; Y &lt;тест&gt;')

    // Наша собственная разметка НЕ экранирована — иначе Anki не проиграет звук.
    expect(front).toMatch(/<br>\[sound:es_04-b1-llamarse-01\.mp3\]$/)
    expect(back).toMatch(/<br>\[sound:ru_04-b1-llamarse-01\.mp3\]$/)
  })
})

/**
 * Мульти-верификаторное ревью (minor, anki-export.service.ts:79): guid раньше был
 * Date.now()+Math.random() — недетерминированный. Регрессия: два НЕЗАВИСИМЫХ вызова
 * buildAnkiPackage() для одного и того же урока должны дать ОДИНАКОВЫЕ guid попарно (позволяет
 * Anki обновлять заметки при повторном импорте вместо дублирования колоды).
 */
describe('РЕГРЕССИЯ: детерминированный guid (anki-export.service.ts:79)', () => {
  let workDir: string
  let lessonDir: string
  let lesson: LessonJson

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-anki-export-guid-'))
    lessonDir = join(workDir, 'lesson')
    new AdmZip(FIXTURE_ZIP).extractAllTo(lessonDir, true)
    lesson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8')) as LessonJson
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('переэкспорт того же урока даёт те же guid попарно (по позиции вставки)', async () => {
    const first = await buildAnkiPackage(lesson, lessonDir)
    // Небольшая пауза, чтобы Date.now() внутри build гарантированно отличался между вызовами —
    // старая реализация (seed=Date.now()+Math.random()) давала бы РАЗНЫЙ guid здесь.
    await new Promise((r) => setTimeout(r, 5))
    const second = await buildAnkiPackage(lesson, lessonDir)

    const notesA = await readNotesTable(first.apkgBuffer)
    const notesB = await readNotesTable(second.apkgBuffer)
    expect(notesA).toHaveLength(notesB.length)
    for (let i = 0; i < notesA.length; i++) {
      expect(notesB[i].guid).toBe(notesA[i].guid)
    }
  })

  it('guid различаются между разными фразами одного урока (не константа)', async () => {
    const { apkgBuffer } = await buildAnkiPackage(lesson, lessonDir)
    const notes = await readNotesTable(apkgBuffer)
    expect(new Set(notes.map((n) => n.guid)).size).toBe(notes.length)
  })
})

/**
 * Мульти-верификаторное ревью (minor, anki-export.service.ts:293): audio.es/audio.ru из
 * lesson.json резолвились без проверки directory traversal. resolveWithinDir() (core/util/paths.ts)
 * теперь бросает, если результат выходит за пределы lessonDir — см. также
 * core/util/paths.test.ts для юнит-тестов самой функции.
 */
describe('РЕГРЕССИЯ: directory traversal через audio.es/audio.ru отклоняется (anki-export.service.ts:293)', () => {
  let workDir: string
  let lessonDir: string
  let lesson: LessonJson

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-anki-export-traversal-'))
    lessonDir = join(workDir, 'lesson')
    new AdmZip(FIXTURE_ZIP).extractAllTo(lessonDir, true)
    lesson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8')) as LessonJson
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('audio.es с "../../" вне lessonDir -> buildAnkiPackage отклоняет, а не читает произвольный файл', async () => {
    const phrase = findPhraseRef(lesson, '04-b1-llamarse-01')
    phrase.audio = { es: '../../../../../../../../etc/hosts', ru: 'audio/ru/04-b1-llamarse-01.mp3' }

    await expect(buildAnkiPackage(lesson, lessonDir)).rejects.toThrow(/выходит за пределы/)
  })

  it('после отклонённого (traversal) вызова следующий нормальный вызов всё равно успешен (db.close() в finally не оставляет процесс в плохом состоянии)', async () => {
    const phrase = findPhraseRef(lesson, '04-b1-llamarse-01')
    phrase.audio = { es: '../../../../../../../../etc/hosts', ru: 'audio/ru/04-b1-llamarse-01.mp3' }
    await expect(buildAnkiPackage(lesson, lessonDir)).rejects.toThrow()

    // Восстанавливаем валидный путь и убеждаемся, что модуль (sqlModulePromise-кэш и т.п.) не
    // "испорчен" предыдущей ошибкой — критично для Electron main, долгоживущего процесса.
    phrase.audio = { es: 'audio/es/04-b1-llamarse-01.mp3', ru: 'audio/ru/04-b1-llamarse-01.mp3' }
    const { noteCount } = await buildAnkiPackage(lesson, lessonDir)
    expect(noteCount).toBe(13)
  })
})
