import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isGroupsBlockJson, type AudioPair, type BlockJson, type DurationPair, type ItemStatus, type LessonJson } from '../core/types/lesson-json'
import type { FileService } from '../core/file/file.service'
import { storySlug } from '../core/queue/build-items'
import type { LibraryEntry, LibraryStatus } from '../shared/ipc'

/**
 * Логика поддержки плоского контракта `window.combineApi` (src/shared/ipc.ts), которой не было
 * у main-агента: listLibrary() (в отличие от вложенного combine:library:list) отдаёт ПОЛНЫЙ
 * LessonJson каждого урока (а не LessonSummary) + статус с четвёртым значением 'empty', а
 * getPhraseAudio читает байты уже сгенерированной фразы по id для плеера библиотеки. Вынесено из
 * ipc-handlers.ts в отдельный модуль без прямой зависимости от 'electron' — так эти функции можно
 * юнит-тестировать напрямую (см. combine-api-support.test.ts), не поднимая ipcMain/ipcRenderer.
 *
 * Пространство каналов: см. docs/DECISIONS.md D-22 — новые операции моста живут на
 * `combine:api:*`, не конфликтуя с существующими `combine:settings:*`/`combine:library:*`/...
 */

function collectStatuses(lesson: LessonJson): ItemStatus[] {
  const statuses: ItemStatus[] = []
  for (const block of lesson.blocks) {
    if (isGroupsBlockJson(block)) {
      for (const group of block.groups) for (const phrase of group.phrases) statuses.push(phrase.status)
    } else if (block.type === 'vocabulary') {
      for (const word of block.words) statuses.push(word.status)
    } else {
      statuses.push(block.status)
    }
  }
  return statuses
}

/**
 * Соответствует деривации в renderer/adapters/mockAdapter.ts#deriveLibraryStatus — единственная
 * эталонная семантика LibraryStatus, на которую ориентировался renderer (все 'done' -> done, все
 * 'failed' -> failed, иначе -> in_progress, отсутствие элементов -> empty). Статус
 * FileService.summarize() (LessonOverallStatus для вложенного API) размечает иначе (ЛЮБОЙ failed
 * -> failed) — сознательно не переиспользуем его здесь, чтобы не разойтись с mockAdapter/UI.
 */
export function deriveLibraryStatus(lesson: LessonJson): LibraryStatus {
  const statuses = collectStatuses(lesson)
  if (statuses.length === 0) return 'empty'
  if (statuses.every((s) => s === 'done')) return 'done'
  if (statuses.every((s) => s === 'failed')) return 'failed'
  return 'in_progress'
}

/** Полный список уроков в outputRoot для плоского listLibrary() — читает КАЖДЫЙ lesson.json целиком. */
export async function buildLibraryEntries(outputRoot: string, fileService: FileService): Promise<LibraryEntry[]> {
  if (!existsSync(outputRoot)) return []
  const dirEntries = await readdir(outputRoot, { withFileTypes: true })
  const entries: LibraryEntry[] = []
  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue
    const topicId = dirEntry.name
    if (!(await fileService.lessonExists(outputRoot, topicId))) continue
    try {
      const lesson = await fileService.readLessonJson(outputRoot, topicId)
      const sizeMb = await fileService.lessonSizeMb(outputRoot, topicId)
      entries.push({ lesson, status: deriveLibraryStatus(lesson), sizeMb: Math.round(sizeMb * 100) / 100 })
    } catch {
      // Повреждённый/незавершённый lesson.json — пропускаем, не валим весь список (см. FileService.listLessons).
    }
  }
  return entries
}

export interface FoundAudioItem {
  audio: AudioPair
  duration_ms: DurationPair
}

/**
 * Находит фразу/слово/рассказ по id (см. src/shared/ipc.ts#GetPhraseAudioInput — story использует
 * синтетический id из build-items.ts#storySlug) для «встроенного плеера фраз» библиотеки.
 */
export function findAudioItem(lesson: LessonJson, phraseId: string): FoundAudioItem | null {
  for (const block of lesson.blocks as BlockJson[]) {
    if (isGroupsBlockJson(block)) {
      for (const group of block.groups) {
        const phrase = group.phrases.find((p) => p.id === phraseId)
        if (phrase) return { audio: phrase.audio, duration_ms: phrase.duration_ms }
      }
    } else if (block.type === 'vocabulary') {
      const word = block.words.find((w) => w.id === phraseId)
      if (word) return { audio: word.audio, duration_ms: word.duration_ms }
    } else if (phraseId === storySlug(lesson.topic_number, block.block_id)) {
      return { audio: block.audio, duration_ms: block.duration_ms }
    }
  }
  return null
}

/** Читает байты уже сгенерированного mp3 фразы/слова и кодирует как data: URI (audio/mpeg — оба провайдера пишут mp3, см. D-04). */
export async function readPhraseAudioDataUrl(
  fileService: FileService,
  outputRoot: string,
  topicId: string,
  phraseId: string,
  lang: 'es' | 'ru'
): Promise<{ audioDataUrl: string; durationMs: number }> {
  const lesson = await fileService.readLessonJson(outputRoot, topicId)
  const found = findAudioItem(lesson, phraseId)
  if (!found) throw new Error(`Фраза "${phraseId}" не найдена в уроке "${topicId}".`)
  const relPath = lang === 'es' ? found.audio.es : found.audio.ru
  const absPath = join(fileService.lessonDir(outputRoot, topicId), ...relPath.split('/'))
  const bytes = await readFile(absPath)
  const durationMs = lang === 'es' ? found.duration_ms.es : found.duration_ms.ru
  return { audioDataUrl: `data:audio/mpeg;base64,${bytes.toString('base64')}`, durationMs }
}
