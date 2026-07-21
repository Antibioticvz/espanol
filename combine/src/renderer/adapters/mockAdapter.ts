/**
 * mockAdapter — реализация CombineIpcApi для dev:web (обычный браузер, без Electron/main-процесса).
 * См. docs/DECISIONS.md D-04/D-09. Задачи:
 *  - parseText реально парсит текст (см. ./mock-data/mock-parser.ts — независимая копия алгоритма
 *    core/parser/parser.service.ts; причина копии, а не импорта, объяснена в шапке того файла);
 *  - "генерация" эмулируется таймерами: ~30 сек на весь урок, статусы pending→generating→done/failed,
 *    парочка 429-ретраев в логах (см. docs/SPEC_COMBINE.md §4.3);
 *  - библиотека, голоса, тестовая генерация — реалистичные заглушки без единого сетевого вызова.
 *
 * ВАЖНО: сюда нельзя импортировать core/queue/build-items.ts, core/parser/parser.service.ts,
 * core/tts/*.service.ts, core/tts/tts-provider.ts или core/util/wav-mp3.ts — первые два не проходят
 * собственный typecheck (см. mock-data/mock-parser.ts), остальные тянут node:path/node:child_process/
 * node:fs и ломают браузерный бандл (vite build для dev:web). Только core/types/** (и core/parser/
 * front-matter.ts + core/util/slug.ts, используемые mock-parser.ts) безопасны для renderer.
 */

import { createDefaultSettings } from '../../core/types/settings'
import type { AppSettings } from '../../core/types/settings'
import type { DurationPair, ItemStatus, LessonJson } from '../../core/types/lesson-json'
import type { GenerationProgressEvent, QueueRunState } from '../../core/types/generation'
import type {
  ActiveGenerationResult,
  ApiKeyStatusResult,
  CombineIpcApi,
  EstimateCostInput,
  EstimateCostResult,
  ExportAnkiInput,
  ExportAnkiResult,
  ExportZipResult,
  GenerationRunRef,
  GetPhraseAudioInput,
  GetPhraseAudioResult,
  LibraryEntry,
  LibraryStatus,
  ListVoicesInput,
  StartGenerationInput,
  StartGenerationResult,
  TestConnectionInput,
  TestConnectionResult,
  TestSnippetInput,
  TestSnippetResult,
  UnsubscribeFn,
  VoiceOption
} from '../../shared/ipc'
import { beepDurationMs, createBeepDataUrl } from './mock-data/beep-audio'
import { voicesForProvider } from './mock-data/mock-voices'
import { createMockLibrary } from './mock-data/mock-library'
import { buildMockLessonJson } from './mock-data/build-lesson'
import { parseLessonText } from './mock-data/mock-parser'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nowStr(): string {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ---------------------------------------------------------------------------
// Настройки (persisted в localStorage — переживает reload страницы в dev:web)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'combine:mock:settings'

function loadSettings(): AppSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) return JSON.parse(raw) as AppSettings
    }
  } catch {
    // повреждённое хранилище — используем дефолт
  }
  return createDefaultSettings('/Users/mock/Documents/combine-lessons')
}

let currentSettings: AppSettings = loadSettings()

function persistSettings(settings: AppSettings): void {
  currentSettings = settings
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // квота/приватный режим — игнорируем, это лишь мок
  }
}

// ---------------------------------------------------------------------------
// API-ключ (v1.2) — персистентность через localStorage (переживает reload dev:web, как
// currentSettings выше). getApiKeyStatus() отдаёт ТОЛЬКО статус, никогда сам ключ — так же, как
// main-процесс никогда не возвращает ключ обратно в renderer (см. shared/ipc.ts).
// ---------------------------------------------------------------------------

const API_KEY_STORAGE_KEY = 'combine:mock:apiKey'

function loadSavedApiKey(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null
  } catch {
    return null
  }
}

/** Явный ключ из вызова побеждает (пользователь ещё печатает, не сохранил) — иначе сохранённый (main-fallback). */
function resolveMockApiKey(explicit: string | null): string | null {
  return explicit && explicit.trim().length > 0 ? explicit : loadSavedApiKey()
}

async function saveApiKey(apiKey: string): Promise<void> {
  await delay(80)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(API_KEY_STORAGE_KEY, apiKey)
  } catch {
    // квота/приватный режим — игнорируем, это лишь мок
  }
}

async function getApiKeyStatus(): Promise<ApiKeyStatusResult> {
  await delay(30)
  return { status: loadSavedApiKey() ? 'ok' : 'none', encryptionAvailable: true }
}

async function clearApiKey(): Promise<void> {
  await delay(30)
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // игнорируем
  }
}

async function checkFfmpegAvailable(): Promise<boolean> {
  await delay(30)
  // dev:web не имеет доступа к child_process/PATH — условно "доступен", чтобы UI можно было
  // проверить в позитивном сценарии; реальная проверка — только в Electron (main/ipc-handlers.ts).
  return true
}

// ---------------------------------------------------------------------------
// Библиотека (в памяти)
// ---------------------------------------------------------------------------

let library: LibraryEntry[] = createMockLibrary()

// ---------------------------------------------------------------------------
// Движок эмуляции генерации
// ---------------------------------------------------------------------------

/** Общая структурная форма узла со статусом — одинаково подходит и PhraseJson, и BlockStoryJson. */
interface StatusBearing {
  status: ItemStatus
  duration_ms: DurationPair
  error?: string | null
  generated_at?: string | null
  id3_tags_written?: boolean
}

interface MockTask {
  phraseId: string
  esText: string
  ruText: string
  node: StatusBearing
}

interface RunState {
  topicId: string
  lessonJson: LessonJson
  settings: AppSettings
  tasks: MockTask[]
  cursor: number
  runState: QueueRunState
  startedAt: number
  spentUsd: number
  timer: ReturnType<typeof setTimeout> | null
  retryAt: Set<number>
}

const runs = new Map<string, RunState>()
const listeners = new Set<(event: GenerationProgressEvent) => void>()

// Порядок веток важен для TS control-flow narrowing — см. подробное пояснение в mock-data/mock-parser.ts
// и mock-data/build-lesson.ts: одноliteральные дискриминанты ('vocabulary', 'story') проверяем явно и
// первыми, мульти-литеральный член (BlockGroupsJson.type: 'verb_group' | 'phrase_group') оставляем
// неявным последним случаем.
function flattenFromLessonJson(lessonJson: LessonJson): MockTask[] {
  const tasks: MockTask[] = []
  for (const block of lessonJson.blocks) {
    if (block.type === 'vocabulary') {
      for (const word of block.words) {
        tasks.push({ phraseId: word.id, esText: word.es, ruText: word.ru, node: word })
      }
    } else if (block.type === 'story') {
      const phraseId = `${String(lessonJson.topic_number).padStart(2, '0')}-${block.block_id}-story`
      tasks.push({ phraseId, esText: block.text_es, ruText: block.text_ru, node: block })
    } else {
      for (const group of block.groups) {
        for (const phrase of group.phrases) {
          tasks.push({ phraseId: phrase.id, esText: phrase.es, ruText: phrase.ru, node: phrase })
        }
      }
    }
  }
  return tasks
}

function resetStatuses(lessonJson: LessonJson, predicate: (status: ItemStatus) => boolean): void {
  for (const task of flattenFromLessonJson(lessonJson)) {
    if (predicate(task.node.status)) {
      task.node.status = 'pending'
      task.node.error = null
      task.node.generated_at = null
      task.node.duration_ms = { es: 0, ru: 0 }
    }
  }
}

function deriveLibraryStatus(lessonJson: LessonJson): LibraryStatus {
  const tasks = flattenFromLessonJson(lessonJson)
  if (tasks.length === 0) return 'empty'
  const done = tasks.filter((t) => t.node.status === 'done').length
  const failed = tasks.filter((t) => t.node.status === 'failed').length
  if (done === tasks.length) return 'done'
  if (failed === tasks.length) return 'failed'
  return 'in_progress'
}

function upsertLibraryEntry(lessonJson: LessonJson): void {
  const status = deriveLibraryStatus(lessonJson)
  const entry: LibraryEntry = { lesson: lessonJson, status, sizeMb: lessonJson.stats.file_size_mb ?? null }
  const idx = library.findIndex((e) => e.lesson.topic_id === lessonJson.topic_id)
  if (idx >= 0) library[idx] = entry
  else library = [entry, ...library]
}

function advanceCursorPastDone(run: RunState): void {
  while (run.cursor < run.tasks.length && run.tasks[run.cursor].node.status === 'done') run.cursor += 1
}

function emitSnapshot(run: RunState, logLine?: string, itemPatch?: GenerationProgressEvent['item']): void {
  let done = 0
  let failed = 0
  let pending = 0
  let generating = 0
  for (const t of run.tasks) {
    if (t.node.status === 'done') done += 1
    else if (t.node.status === 'failed') failed += 1
    else if (t.node.status === 'generating') generating += 1
    else pending += 1
  }
  const elapsedMs = Date.now() - run.startedAt
  const speedPerMin = elapsedMs > 1000 ? done / (elapsedMs / 60000) : 0
  const remaining = run.tasks.length - done - failed
  const etaSeconds = speedPerMin > 0.01 ? Math.round((remaining / speedPerMin) * 60) : null
  const current = run.tasks[run.cursor]

  const event: GenerationProgressEvent = {
    runState: run.runState,
    totalItems: run.tasks.length,
    doneItems: done,
    failedItems: failed,
    pendingItems: pending,
    generatingItems: generating,
    currentItemId: current ? current.phraseId : null,
    currentText: current ? current.esText : null,
    elapsedMs,
    speedPerMin: Math.round(speedPerMin * 10) / 10,
    etaSeconds,
    spentUsd: Math.round(run.spentUsd * 10000) / 10000,
    item: itemPatch,
    logLine
  }
  for (const listener of listeners) listener(event)
}

function finishTask(task: MockTask, run: RunState): void {
  if (run.runState !== 'running') return
  const esDur = beepDurationMs(task.esText)
  const ruDur = beepDurationMs(task.ruText)
  task.node.status = 'done'
  task.node.duration_ms = { es: esDur, ru: ruDur }
  task.node.generated_at = new Date().toISOString()
  task.node.id3_tags_written = run.settings.addId3Tags

  const chars = task.esText.length + task.ruText.length
  const price = run.settings.pricePerThousandChars[run.settings.model] ?? 0
  run.spentUsd += (chars / 1000) * price
  run.lessonJson.stats.actual_cost_usd = Math.round(run.spentUsd * 10000) / 10000

  emitSnapshot(run, `[${nowStr()}] ✓ ${task.phraseId} (ES) Done · ✓ ${task.phraseId} (RU) Done`, {
    phraseId: task.phraseId,
    status: 'done',
    durationMs: esDur + ruDur
  })

  run.cursor += 1
  const total = Math.max(1, run.tasks.length)
  const gapMs = Math.min(400, Math.max(60, (30000 / total) * 0.2))
  run.timer = setTimeout(() => scheduleNext(run), gapMs)
}

function scheduleNext(run: RunState): void {
  if (run.runState !== 'running') return
  advanceCursorPastDone(run)

  if (run.cursor >= run.tasks.length) {
    run.runState = 'done'
    upsertLibraryEntry(run.lessonJson)
    emitSnapshot(run, `[${nowStr()}] Генерация завершена: «${run.lessonJson.title_ru}».`)
    runs.delete(run.topicId)
    return
  }

  const task = run.tasks[run.cursor]
  task.node.status = 'generating'
  const total = Math.max(1, run.tasks.length)
  const perTaskMs = Math.min(3000, Math.max(180, 30000 / total))

  emitSnapshot(run, `[${nowStr()}] ${task.phraseId} — генерация (ES)…`, {
    phraseId: task.phraseId,
    status: 'generating'
  })

  if (run.retryAt.has(run.cursor)) {
    run.timer = setTimeout(() => {
      if (run.runState !== 'running') return
      emitSnapshot(run, `[${nowStr()}] ⚠ ${task.phraseId} (ES) 429 Too Many Requests → retry #1/3`)
      run.timer = setTimeout(() => {
        if (run.runState !== 'running') return
        emitSnapshot(run, `[${nowStr()}] ⚠ ${task.phraseId} (ES) 429 Too Many Requests → retry #2/3`)
        run.timer = setTimeout(() => finishTask(task, run), perTaskMs * 0.6)
      }, perTaskMs * 0.6)
    }, perTaskMs * 0.3)
  } else {
    run.timer = setTimeout(() => finishTask(task, run), perTaskMs)
  }
}

function beginRun(lessonJson: LessonJson, settings: AppSettings): RunState {
  const existing = runs.get(lessonJson.topic_id)
  if (existing?.timer) clearTimeout(existing.timer)

  const tasks = flattenFromLessonJson(lessonJson)
  const pendingIdx = tasks.map((_, i) => i).filter((i) => tasks[i].node.status !== 'done')
  const shuffled = [...pendingIdx].sort(() => Math.random() - 0.5)
  const retryAt = new Set(shuffled.slice(0, Math.min(2, shuffled.length)))

  const run: RunState = {
    topicId: lessonJson.topic_id,
    lessonJson,
    settings,
    tasks,
    cursor: 0,
    runState: 'running',
    startedAt: Date.now(),
    spentUsd: lessonJson.stats.actual_cost_usd ?? 0,
    timer: null,
    retryAt
  }
  runs.set(run.topicId, run)
  upsertLibraryEntry(lessonJson)
  advanceCursorPastDone(run)
  emitSnapshot(run, `[${nowStr()}] Запуск генерации: «${lessonJson.title_ru}» (${tasks.length} элементов).`)
  scheduleNext(run)
  return run
}

function cloneLesson(lessonJson: LessonJson): LessonJson {
  return JSON.parse(JSON.stringify(lessonJson)) as LessonJson
}

// ---------------------------------------------------------------------------
// Реализация CombineIpcApi
// ---------------------------------------------------------------------------

async function parseText(raw: string) {
  await delay(30)
  return parseLessonText(raw)
}

async function getSettings(): Promise<AppSettings> {
  await delay(50)
  return currentSettings
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await delay(50)
  persistSettings(settings)
}

async function testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
  await delay(300)
  if (input.provider === 'mock_say') {
    return {
      ok: true,
      message: 'Mock-провайдер (macOS say) всегда доступен — реальный API-ключ не требуется.',
      voiceCount: voicesForProvider('mock_say').length
    }
  }
  const key = (resolveMockApiKey(input.apiKey) ?? '').trim()
  if (!key) return { ok: false, message: 'Введите API-ключ ElevenLabs (или сохраните его в настройках).' }
  if (key.toLowerCase() === 'invalid') return { ok: false, message: 'Неверный API-ключ (401 Unauthorized).' }
  return { ok: true, message: 'Подключение активно.', voiceCount: voicesForProvider('elevenlabs').length }
}

async function listVoices(input: ListVoicesInput): Promise<VoiceOption[]> {
  await delay(200)
  return voicesForProvider(input.provider)
}

async function estimateCost(input: EstimateCostInput): Promise<EstimateCostResult> {
  await delay(30)
  const totalCharacters = input.charactersEs + input.charactersRu
  const pricePerThousand = input.pricePerThousandChars[input.model] ?? 0
  return {
    totalCharacters,
    pricePerThousand,
    estimatedCostUsd: Math.round((totalCharacters / 1000) * pricePerThousand * 10000) / 10000,
    note: 'Это оценка, ±5% из-за особенностей подсчёта символов ElevenLabs. Реальная цена уточнится после генерации.'
  }
}

async function startGeneration(input: StartGenerationInput): Promise<StartGenerationResult> {
  await delay(150)
  if (input.settings.provider === 'elevenlabs' && !resolveMockApiKey(input.apiKey)) {
    throw new Error('API-ключ ElevenLabs не задан — введите ключ или сохраните его в настройках.')
  }
  const lessonJson = buildMockLessonJson(input.lesson, {
    provider: input.settings.provider,
    model: input.settings.model,
    voiceEs: input.settings.voiceEs ?? { id: 'mock-es-pablo', name: 'Pablo' },
    voiceRu: input.settings.voiceRu ?? { id: 'mock-ru-masha', name: 'Masha' },
    stability: input.settings.stability,
    similarityBoost: input.settings.similarityBoost,
    seed: input.settings.seed,
    pricePerThousandChars: input.settings.pricePerThousandChars[input.settings.model] ?? 0,
    createdAt: new Date(),
    statusForIndex: () => 'pending'
  })
  const run = beginRun(lessonJson, input.settings)
  return { topicId: run.topicId, lesson: cloneLesson(run.lessonJson) }
}

async function pauseGeneration({ topicId }: GenerationRunRef): Promise<void> {
  const run = runs.get(topicId)
  if (!run || run.runState !== 'running') return
  run.runState = 'paused'
  if (run.timer) clearTimeout(run.timer)
  const current = run.tasks[run.cursor]
  if (current && current.node.status === 'generating') current.node.status = 'pending'
  emitSnapshot(run, `[${nowStr()}] Пауза. Прогресс сохранён.`)
}

async function resumeGeneration({ topicId }: GenerationRunRef): Promise<void> {
  const run = runs.get(topicId)
  if (!run || run.runState === 'done' || run.runState === 'cancelled') return
  run.runState = 'running'
  emitSnapshot(run, `[${nowStr()}] Возобновление генерации…`)
  scheduleNext(run)
}

async function cancelGeneration({ topicId }: GenerationRunRef): Promise<void> {
  const run = runs.get(topicId)
  if (!run) return
  run.runState = 'cancelled'
  if (run.timer) clearTimeout(run.timer)
  const current = run.tasks[run.cursor]
  if (current && current.node.status === 'generating') current.node.status = 'pending'
  upsertLibraryEntry(run.lessonJson)
  emitSnapshot(run, `[${nowStr()}] Генерация отменена пользователем.`)
  runs.delete(topicId)
}

function onGenerationProgress(callback: (event: GenerationProgressEvent) => void): UnsubscribeFn {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Мульти-верификаторное ревью — переподключение к уже идущему прогону при (пере)монтировании хука. */
async function getActiveGeneration(): Promise<ActiveGenerationResult | null> {
  await delay(30)
  const run = runs.values().next().value
  if (!run) return null
  return { topicId: run.topicId, lesson: cloneLesson(run.lessonJson), runState: run.runState }
}

async function listLibrary(): Promise<LibraryEntry[]> {
  await delay(150)
  return library
}

async function exportZip({ topicId }: GenerationRunRef): Promise<ExportZipResult> {
  await delay(400)
  const entry = library.find((e) => e.lesson.topic_id === topicId)
  if (!entry) throw new Error(`Урок "${topicId}" не найден в библиотеке.`)
  return { zipPath: `~/Downloads/lesson-${topicId}.zip` }
}

async function regenerateAll({ topicId }: GenerationRunRef): Promise<StartGenerationResult> {
  await delay(100)
  const entry = library.find((e) => e.lesson.topic_id === topicId)
  if (!entry) throw new Error(`Урок "${topicId}" не найден в библиотеке.`)
  const clone = cloneLesson(entry.lesson)
  resetStatuses(clone, () => true)
  const run = beginRun(clone, currentSettings)
  return { topicId: run.topicId, lesson: cloneLesson(run.lessonJson) }
}

async function regenerateFailed({ topicId }: GenerationRunRef): Promise<StartGenerationResult> {
  await delay(100)
  const entry = library.find((e) => e.lesson.topic_id === topicId)
  if (!entry) throw new Error(`Урок "${topicId}" не найден в библиотеке.`)
  const clone = cloneLesson(entry.lesson)
  resetStatuses(clone, (status) => status === 'failed')
  const run = beginRun(clone, currentSettings)
  return { topicId: run.topicId, lesson: cloneLesson(run.lessonJson) }
}

async function deleteLesson({ topicId }: GenerationRunRef): Promise<void> {
  await delay(150)
  const run = runs.get(topicId)
  if (run?.timer) clearTimeout(run.timer)
  runs.delete(topicId)
  library = library.filter((e) => e.lesson.topic_id !== topicId)
}

async function openLessonFolder({ topicId }: GenerationRunRef): Promise<void> {
  await delay(80)
  // «Открыть в Finder» не имеет смысла в браузерном превью dev:web — тихо игнорируем (см. D-09).
  console.info(`[mockAdapter] openLessonFolder(${topicId}) — недоступно в dev:web, требует Electron.`)
}

async function testSnippet(input: TestSnippetInput): Promise<TestSnippetResult> {
  await delay(500)
  if (input.provider === 'elevenlabs' && !resolveMockApiKey(input.apiKey)) {
    throw new Error('API-ключ ElevenLabs не задан — введите ключ или сохраните его в настройках.')
  }
  const durationMs = beepDurationMs(input.text)
  const price = currentSettings.pricePerThousandChars[input.model] ?? 0
  const characters = input.text.length
  return {
    audioDataUrl: createBeepDataUrl({ durationMs, freqHz: input.lang === 'es' ? 260 : 300 }),
    durationMs,
    characters,
    costUsd: Math.round((characters / 1000) * price * 10000) / 10000
  }
}

/** Порядок веток важен для TS narrowing — см. комментарий у flattenFromLessonJson выше. Story
 * намеренно пропускается: Anki-карточки делаются только из фраз/слов (см. shared/ipc.ts#exportAnki). */
function countAnkiItems(lessonJson: LessonJson): number {
  let count = 0
  for (const block of lessonJson.blocks) {
    if (block.type === 'vocabulary') {
      count += block.words.length
    } else if (block.type === 'story') {
      continue
    } else {
      for (const group of block.groups) count += group.phrases.length
    }
  }
  return count
}

async function exportAnki({ topicId }: ExportAnkiInput): Promise<ExportAnkiResult> {
  await delay(400)
  const entry = library.find((e) => e.lesson.topic_id === topicId)
  if (!entry) throw new Error(`Урок "${topicId}" не найден в библиотеке.`)
  const noteCount = countAnkiItems(entry.lesson)
  return { apkgPath: `~/Downloads/lesson-${topicId}.apkg`, noteCount, mediaCount: noteCount * 2 }
}

async function getPhraseAudio(input: GetPhraseAudioInput): Promise<GetPhraseAudioResult> {
  await delay(150)
  const entry = library.find((e) => e.lesson.topic_id === input.topicId)
  if (!entry) throw new Error(`Урок "${input.topicId}" не найден.`)
  const task = flattenFromLessonJson(entry.lesson).find((t) => t.phraseId === input.phraseId)
  const text = task ? (input.lang === 'es' ? task.esText : task.ruText) : 'audio'
  const durationMs = beepDurationMs(text)
  return {
    audioDataUrl: createBeepDataUrl({ durationMs, freqHz: input.lang === 'es' ? 260 : 300 }),
    durationMs
  }
}

export const mockAdapter: CombineIpcApi = {
  parseText,
  getSettings,
  saveSettings,
  saveApiKey,
  getApiKeyStatus,
  clearApiKey,
  testConnection,
  listVoices,
  estimateCost,
  startGeneration,
  pauseGeneration,
  resumeGeneration,
  cancelGeneration,
  onGenerationProgress,
  getActiveGeneration,
  listLibrary,
  exportZip,
  regenerateAll,
  regenerateFailed,
  deleteLesson,
  openLessonFolder,
  testSnippet,
  getPhraseAudio,
  exportAnki,
  checkFfmpegAvailable
}
