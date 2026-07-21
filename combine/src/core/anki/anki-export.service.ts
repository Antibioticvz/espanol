import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import AdmZip from 'adm-zip'
import initSqlJs from 'sql.js'
import { isGroupsBlockJson, type LessonJson, type PhraseJson } from '../types/lesson-json'

/**
 * Экспорт урока в Anki (.apkg) — v1.1. БЕЗ нативных зависимостей: SQLite-файл `collection.anki2`
 * собирается через sql.js (SQLite, скомпилированный в WASM Emscripten'ом) — чистый JS/WASM,
 * не требует node-gyp/пересборки под Electron ABI (см. docs/DECISIONS.md — единственное разумное
 * решение для "без нативных зависимостей": руками собирать SQLite b-tree формат по байтам
 * нереалистично, а sql.js — ровно то же самое SQLite, что и настоящий Anki, просто в WASM).
 *
 * Формат .apkg — обычный ZIP:
 *  - collection.anki2   — SQLite база (схема "legacy", ver=11 — совместима с любой версией
 *                          настольного Anki; сам Anki при импорте .apkg делает merge/renumber ID,
 *                          так что коллизии наших синтетических id с коллекцией пользователя не проблема);
 *  - media              — JSON-манифест {"0": "es_<id>.mp3", "1": "ru_<id>.mp3", ...} — числовой
 *                          КЛЮЧ одновременно является ИМЕНЕМ файла внутри архива (без расширения);
 *  - "0", "1", ...       — сами файлы (байты mp3), имя = числовой индекс.
 *
 * Колода = title_ru урока. Note type — 2 поля (Front/Back), 1 шаблон карточки. Карточки — из ВСЕХ
 * фраз/слов урока (verb_group/phrase_group/vocabulary); story ПРОПУСКАЕТСЯ (см. collectAnkiItems) —
 * рассказ не бьётся на короткие Q/A-карточки естественным образом.
 */

export interface AnkiExportOutcome {
  apkgBuffer: Buffer
  noteCount: number
  mediaCount: number
}

const SCHEMA_VER = 11

let sqlModulePromise: ReturnType<typeof initSqlJs> | null = null
function getSqlJs(): ReturnType<typeof initSqlJs> {
  if (!sqlModulePromise) sqlModulePromise = initSqlJs()
  return sqlModulePromise
}

/**
 * Порядок веток — та же оговорка про TS control-flow narrowing, что и в core/queue/build-items.ts/
 * renderer/adapters/mockAdapter.ts: isGroupsBlockJson() первым, 'vocabulary' явно, 'story' —
 * неявный последний случай (здесь буквально пропускается, а не обрабатывается).
 */
function collectAnkiItems(lesson: LessonJson): PhraseJson[] {
  const items: PhraseJson[] = []
  for (const block of lesson.blocks) {
    if (isGroupsBlockJson(block)) {
      for (const group of block.groups) items.push(...group.phrases)
    } else if (block.type === 'vocabulary') {
      items.push(...block.words)
    }
    // story: намеренно пропускается для Anki-экспорта (не бьётся на карточки естественно).
  }
  return items
}

function esMediaName(itemId: string): string {
  return `es_${itemId}.mp3`
}

function ruMediaName(itemId: string): string {
  return `ru_${itemId}.mp3`
}

/** Anki csum — первые 8 hex-цифр sha1() поля ПОСЛЕ удаления [sound:...] и HTML-тегов, как integer. */
function fieldChecksum(field: string): number {
  const stripped = field
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
  const hex = createHash('sha1').update(stripped, 'utf8').digest('hex')
  return parseInt(hex.slice(0, 8), 16)
}

function randomGuid(seed: number): string {
  return `${seed.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

const SCHEMA_SQL = `
CREATE TABLE col (
  id     integer primary key,
  crt    integer not null,
  mod    integer not null,
  scm    integer not null,
  ver    integer not null,
  dty    integer not null,
  usn    integer not null,
  ls     integer not null,
  conf   text not null,
  models text not null,
  decks  text not null,
  dconf  text not null,
  tags   text not null
);
CREATE TABLE notes (
  id    integer primary key,
  guid  text not null,
  mid   integer not null,
  mod   integer not null,
  usn   integer not null,
  tags  text not null,
  flds  text not null,
  sfld  text not null,
  csum  integer not null,
  flags integer not null,
  data  text not null
);
CREATE TABLE cards (
  id    integer primary key,
  nid   integer not null,
  did   integer not null,
  ord   integer not null,
  mod   integer not null,
  usn   integer not null,
  type  integer not null,
  queue integer not null,
  due   integer not null,
  ivl   integer not null,
  factor integer not null,
  reps  integer not null,
  lapses integer not null,
  left  integer not null,
  odue  integer not null,
  odid  integer not null,
  flags integer not null,
  data  text not null
);
CREATE TABLE revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);
CREATE TABLE graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`

/** Собирает .apkg в памяти (Buffer) — не пишет на диск, см. exportLessonToAnki() ниже для этого. */
export async function buildAnkiPackage(lesson: LessonJson, lessonDir: string): Promise<AnkiExportOutcome> {
  const items = collectAnkiItems(lesson)
  const SQL = await getSqlJs()
  const db = new SQL.Database()
  db.run(SCHEMA_SQL)

  const nowMs = Date.now()
  const nowSec = Math.floor(nowMs / 1000)
  const modelId = nowMs
  const deckId = nowMs + 1

  const model = {
    id: modelId,
    name: `Combine — ${lesson.title_ru}`,
    type: 0,
    mod: nowSec,
    usn: 0,
    sortf: 0,
    did: deckId,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
        did: null,
        bqfmt: '',
        bafmt: ''
      }
    ],
    flds: [
      { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
      { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 }
    ],
    css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    latexPre:
      '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    req: [[0, 'any', [0]]],
    tags: [],
    vers: []
  }

  const deck = {
    id: deckId,
    mod: nowSec,
    name: lesson.title_ru,
    usn: 0,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: `Combine — ${lesson.topic_id} (экспортировано автоматически, story не включён).`,
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0
  }

  const dconf = {
    '1': {
      id: 1,
      mod: 0,
      name: 'Default',
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20 },
      rev: { bury: true, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false
    }
  }

  const conf = {
    nextPos: items.length + 1,
    estTimes: true,
    activeDecks: [deckId],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: deckId,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(modelId),
    collapseTime: 1200
  }

  db.run('INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1,?,?,?,?,0,0,0,?,?,?,?,\'{}\')', [
    nowSec,
    nowMs,
    nowMs,
    SCHEMA_VER,
    JSON.stringify(conf),
    JSON.stringify({ [String(modelId)]: model }),
    JSON.stringify({ [String(deckId)]: deck }),
    JSON.stringify(dconf)
  ])

  const zip = new AdmZip()
  const mediaManifest: Record<string, string> = {}
  let mediaIndex = 0
  let position = 0

  for (const item of items) {
    const noteId = nowMs + position * 2
    const cardId = nowMs + position * 2 + 1

    const esName = esMediaName(item.id)
    const ruName = ruMediaName(item.id)
    const front = `${item.es}<br>[sound:${esName}]`
    const back = `${item.ru}<br>[sound:${ruName}]`
    const flds = `${front}\x1f${back}`

    db.run('INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?,?,?,?,0,\'\',?,?,?,0,\'\')', [
      noteId,
      randomGuid(noteId),
      modelId,
      nowSec,
      flds,
      item.es,
      fieldChecksum(front)
    ])

    db.run(
      'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) ' +
        "VALUES (?,?,?,0,?,0,0,0,?,0,0,0,0,0,0,0,0,'')",
      [cardId, noteId, deckId, nowSec, position + 1]
    )

    const esBytes = await readFile(join(lessonDir, ...item.audio.es.split('/')))
    zip.addFile(String(mediaIndex), esBytes)
    mediaManifest[String(mediaIndex)] = esName
    mediaIndex += 1

    const ruBytes = await readFile(join(lessonDir, ...item.audio.ru.split('/')))
    zip.addFile(String(mediaIndex), ruBytes)
    mediaManifest[String(mediaIndex)] = ruName
    mediaIndex += 1

    position += 1
  }

  const apkgSqliteBytes = db.export()
  db.close()

  zip.addFile('collection.anki2', Buffer.from(apkgSqliteBytes))
  zip.addFile('media', Buffer.from(JSON.stringify(mediaManifest), 'utf8'))

  return { apkgBuffer: zip.toBuffer(), noteCount: items.length, mediaCount: mediaIndex }
}

/** Путь по умолчанию для .apkg — рядом с папками уроков, `<outputRoot>/<topicId>.apkg` (см. FileService.defaultZipPath). */
export function defaultApkgPath(outputRoot: string, topicId: string): string {
  return join(outputRoot, `${topicId}.apkg`)
}

/** Удобная обёртка: собирает .apkg и пишет его по destApkgPath (создавая родительские папки при необходимости). */
export async function exportLessonToAnki(
  lesson: LessonJson,
  lessonDir: string,
  destApkgPath: string
): Promise<{ apkgPath: string; noteCount: number; mediaCount: number }> {
  const { apkgBuffer, noteCount, mediaCount } = await buildAnkiPackage(lesson, lessonDir)
  await mkdir(dirname(destApkgPath), { recursive: true })
  await writeFile(destApkgPath, apkgBuffer)
  return { apkgPath: destApkgPath, noteCount, mediaCount }
}
