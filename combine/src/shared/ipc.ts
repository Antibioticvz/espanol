/**
 * Typed IPC-контракт между renderer (UI) и main-процессом Combine.
 *
 * Это ПРЕДЛОЖЕНИЕ контракта со стороны renderer-агента, впоследствии СОСТЫКОВАННОЕ (v1.1,
 * docs/DECISIONS.md D-22): src/preload/index.ts реализует именно этот интерфейс как
 * `window.combineApi`, поверх main-хендлеров src/main/ipc-handlers.ts (частично существующих
 * `combine:*` каналов, частично новых `combine:api:*`). Расхождения в деталях реализации
 * (имена IPC-каналов, внутренняя структура main) не важны — важна полнота набора операций и то,
 * что typecheck (`npm run typecheck`, оба tsconfig) проходит на обеих сторонах моста.
 *
 * Соглашение по мосту preload → renderer: main-процесс ожидается экспонирующим этот интерфейс как
 * `window.combineApi` через `contextBridge.exposeInMainWorld('combineApi', api)` (см. adapters/ipcAdapter.ts).
 * Если preload-агент выбрал другое имя/форму моста — адаптер renderer тривиально поправить в одном месте.
 *
 * Все типы данных максимально переиспользуют домен из combine/src/core/types/** (см. docs/DECISIONS.md),
 * чтобы UI и main говорили на одном языке типов без дублирования и ручного маппинга. Единственное
 * исключение — VoiceOption ниже: core/tts/tts-provider.ts (TtsVoice) на момент написания не проходит
 * собственный typecheck (не связано с renderer — падает и под tsconfig.node.json: `Cannot find name
 * 'Buffer'` в соседнем TtsSynthesizeResult того же файла, т.к. "types" web-проекта не включает "node").
 * combine/src/core/** — чужая зона (правит параллельный агент), поэтому здесь структурно повторяем ту же
 * форму локально, вместо импорта из файла с посторонней Node-специфичной сигнатурой.
 */

import type { ParseResult, ParsedLesson } from '../core/types/parsed-lesson'
import type { AppSettings, PricingTable } from '../core/types/settings'
import type { LessonJson, Provider } from '../core/types/lesson-json'
import type { GenerationProgressEvent, Lang } from '../core/types/generation'

// ---------------------------------------------------------------------------
// parseText
// ---------------------------------------------------------------------------

/** Результат разбора — см. core/types/parsed-lesson.ts (переиспользуется как есть). */
export type ParseTextResult = ParseResult

// ---------------------------------------------------------------------------
// getSettings / saveSettings
// ---------------------------------------------------------------------------
// AppSettings переиспользуется из core/types/settings.ts без изменений.

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

export interface TestConnectionInput {
  provider: Provider
  /** null допустим для mock_say — ключ не требуется. */
  apiKey: string | null
}

export interface TestConnectionResult {
  ok: boolean
  /** Человекочитаемое сообщение на русском (для UI) — успех или причина отказа. */
  message: string
  /** Кол-во голосов, доступных провайдеру (если удалось получить) — для «Подключение активно, N голосов». */
  voiceCount?: number
}

// ---------------------------------------------------------------------------
// listVoices
// ---------------------------------------------------------------------------

export interface ListVoicesInput {
  provider: Provider
  apiKey: string | null
}

/**
 * Голос TTS с preview_url (D-02: voice_id непрозрачен, грузится динамически через GET /v1/voices).
 * Структурно повторяет core/tts/tts-provider.ts#TtsVoice — см. пояснение в шапке файла.
 */
export interface VoiceOption {
  id: string
  name: string
  previewUrl: string | null
  category?: string | null
  labels?: Record<string, string>
}

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

export interface EstimateCostInput {
  model: string
  /** Редактируемая таблица цен из настроек (D-06: цены не хардкодим). */
  pricePerThousandChars: PricingTable
  charactersEs: number
  charactersRu: number
}

export interface EstimateCostResult {
  totalCharacters: number
  /** Цена за 1000 символов, фактически применённая (0, если модель не найдена в таблице). */
  pricePerThousand: number
  estimatedCostUsd: number
  /** Пояснение «это оценка, ±5%» и т.п. — показывается прямо под цифрой в UI. */
  note: string
}

// ---------------------------------------------------------------------------
// startGeneration / pause / resume / cancel
// ---------------------------------------------------------------------------

export interface StartGenerationInput {
  lesson: ParsedLesson
  settings: AppSettings
  /**
   * AppSettings (core/types/settings.ts) сознательно НЕ хранит API-ключ (в реальном приложении он живёт
   * в Keychain через electron-safe-storage — см. docs/SPEC_COMBINE.md §3.1, "Безопасность"). Поэтому ключ
   * передаётся отдельным полем, как и в testConnection/listVoices/testSnippet — main-процесс достаёт его
   * из secure storage самостоятельно и здесь он приходит из renderer только пока пользователь его вводит.
   */
  apiKey: string | null
}

/** Ссылка на запущенный процесс генерации — topic_id одновременно является ключом урока в библиотеке. */
export interface GenerationRunRef {
  topicId: string
}

/**
 * Результат старта/рестарта генерации. Помимо topicId включает СТАТИЧЕСКИЙ скелет урока (все блоки/группы/
 * фразы с начальными статусами) — GenerationProgressEvent (core/types/generation.ts) намеренно несёт только
 * агрегаты + патч ОДНОГО элемента за раз (см. комментарий у onGenerationProgress), поэтому дерево блоков
 * экрану генерации нужно построить один раз отсюда, а затем обновлять по id из потока событий.
 */
export interface StartGenerationResult {
  topicId: string
  lesson: LessonJson
}

// ---------------------------------------------------------------------------
// onGenerationProgress
// ---------------------------------------------------------------------------
// GenerationProgressEvent переиспользуется из core/types/generation.ts без изменений
// (runState, totals, currentItem, speed/eta, spentUsd, item-патч, logLine — см. спеку §4.3).

/** Подписка на события прогресса; возвращает функцию отписки (аналог ipcRenderer.removeListener). */
export type UnsubscribeFn = () => void

// ---------------------------------------------------------------------------
// listLibrary
// ---------------------------------------------------------------------------

export type LibraryStatus = 'done' | 'in_progress' | 'failed' | 'empty'

export interface LibraryEntry {
  lesson: LessonJson
  status: LibraryStatus
  /** Размер папки урока на диске (audio/*) — дублирует lesson.stats.file_size_mb для удобства сортировки. */
  sizeMb: number | null
}

// ---------------------------------------------------------------------------
// exportZip / regenerateAll / regenerateFailed / deleteLesson / openLessonFolder
// ---------------------------------------------------------------------------

export interface ExportZipResult {
  zipPath: string
}

// ---------------------------------------------------------------------------
// testSnippet (D-05 — дешёвый тест-режим)
// ---------------------------------------------------------------------------

export interface TestSnippetInput {
  text: string
  lang: Lang
  voiceId: string
  voiceName: string
  provider: Provider
  model: string
  apiKey: string | null
  stability?: number | null
  similarityBoost?: number | null
}

export interface TestSnippetResult {
  /** data: URI (audio/mpeg или audio/wav) — воспроизводится напрямую в <audio>, без промежуточного файла. */
  audioDataUrl: string
  durationMs: number
  /** Фактически озвученные символы — основа расчёта реальной стоимости (не оценки). */
  characters: number
  costUsd: number
}

// ---------------------------------------------------------------------------
// getPhraseAudio — ДОПОЛНЕНИЕ к 18 операциям из спеки.
// Нужно для «встроенного плеера фраз» на экране Библиотеки (§4.4): lesson.json хранит только
// относительные пути audio/{lang}/{id}.mp3, а не байты. Ленивая догрузка по клику на фразу —
// естественное расширение контракта, а не альтернатива testSnippet (тот — для сырого текста,
// этот — для уже сгенерированной фразы урока по её id).
// ---------------------------------------------------------------------------

export interface GetPhraseAudioInput {
  topicId: string
  /** id фразы/слова (PhraseJson.id) либо синтетический id рассказа (см. core/queue/build-items.ts storySlug). */
  phraseId: string
  lang: Lang
}

export interface GetPhraseAudioResult {
  audioDataUrl: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// exportAnki — v1.1, ДОПОЛНЕНИЕ к контракту (см. docs/DECISIONS.md, задача «экспорт в Anki»).
// Пункт меню карточки урока в Библиотеке «Экспорт в Anki» — упаковывает фразы+слова урока
// (story пропускается) в .apkg (см. core/anki/anki-export.service.ts).
// ---------------------------------------------------------------------------

export interface ExportAnkiInput {
  topicId: string
}

export interface ExportAnkiResult {
  apkgPath: string
  /** Число нот/карточек (фразы+слова, без story). */
  noteCount: number
  /** Число media-файлов в пакете (обычно noteCount × 2 — по ES+RU аудио на элемент). */
  mediaCount: number
}

// ---------------------------------------------------------------------------
// Полный контракт
// ---------------------------------------------------------------------------

export interface CombineIpcApi {
  /** Живой парсинг текста урока в структуру (см. docs/SPEC_COMBINE.md §2). Чистая функция на стороне main. */
  parseText(raw: string): Promise<ParseTextResult>

  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>

  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>
  listVoices(input: ListVoicesInput): Promise<VoiceOption[]>
  estimateCost(input: EstimateCostInput): Promise<EstimateCostResult>

  startGeneration(input: StartGenerationInput): Promise<StartGenerationResult>
  pauseGeneration(input: GenerationRunRef): Promise<void>
  resumeGeneration(input: GenerationRunRef): Promise<void>
  cancelGeneration(input: GenerationRunRef): Promise<void>
  /** Подписка на прогресс генерации (статус элемента, лог-строки, потрачено). Может относиться к любому runId. */
  onGenerationProgress(callback: (event: GenerationProgressEvent) => void): UnsubscribeFn

  listLibrary(): Promise<LibraryEntry[]>
  exportZip(input: GenerationRunRef): Promise<ExportZipResult>
  regenerateAll(input: GenerationRunRef): Promise<StartGenerationResult>
  regenerateFailed(input: GenerationRunRef): Promise<StartGenerationResult>
  deleteLesson(input: GenerationRunRef): Promise<void>
  openLessonFolder(input: GenerationRunRef): Promise<void>

  /** D-05: тестовая генерация одной короткой фразы — проверка ключа/голоса до дорогой генерации всей темы. */
  testSnippet(input: TestSnippetInput): Promise<TestSnippetResult>

  /** Ленивая загрузка байтов уже сгенерированной фразы для плеера библиотеки (см. комментарий выше). */
  getPhraseAudio(input: GetPhraseAudioInput): Promise<GetPhraseAudioResult>

  /** v1.1: экспорт урока в Anki .apkg — см. комментарий у ExportAnkiInput выше. */
  exportAnki(input: ExportAnkiInput): Promise<ExportAnkiResult>
}
