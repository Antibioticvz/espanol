import { dialog, ipcMain, shell } from 'electron'
import { ParserService } from '../core/parser/parser.service'
import { MockSayService } from '../core/tts/mock-say.service'
import { ElevenLabsService } from '../core/tts/eleven-labs.service'
import type { TTSProvider } from '../core/tts/tts-provider'
import type { AppSettings } from '../core/types/settings'
import type { GenerationProgressEvent, QueueConfig } from '../core/types/generation'
import type { Provider } from '../core/types/lesson-json'
import { CostCalculator } from '../core/cost/cost-calculator'
import { getAppContext } from './services-bootstrap'
import { generationSession } from './generation-session'
import { runTestGeneration, type TestGenerationParams } from './test-generation'
import { getCurrentWindow } from './window'
import { assertKnownOutputRoot, assertSaneOutputRoot } from './path-guard'
import { buildLibraryEntries, readPhraseAudioDataUrl } from './combine-api-support'
import { defaultApkgPath, exportLessonToAnki } from '../core/anki/anki-export.service'
import type {
  EstimateCostInput,
  ExportAnkiInput,
  GenerationRunRef,
  GetPhraseAudioInput,
  ListVoicesInput,
  StartGenerationInput,
  TestConnectionInput,
  TestSnippetInput
} from '../shared/ipc'

/**
 * Регистрирует все IPC-хендлеры main-процесса. Вызывается РОВНО ОДИН РАЗ за жизнь процесса (см.
 * index.ts) — ipcMain.handle бросает при повторной регистрации того же канала, поэтому это НЕ
 * привязано к конкретному BrowserWindow: где нужно окно (прогресс-события, dialog), берём его
 * динамически через window.ts#getCurrentWindow() (issue #5 второго ревью).
 *
 * Имена каналов ниже — рабочий вариант этого агента; финальную стыковку с renderer (который
 * строится параллельно в ветке feat/combine-ui) делает оркестратор при merge — сознательно не
 * пытаемся угадать точные имена оттуда.
 *
 * Операции: parseText, settings (get/save/api-key/test-connection), voices/models, testGenerate
 * (D-05 «Тестовая генерация»), generation (start/pause/resume/cancel + прогресс-события),
 * library (list/delete/export/regenerate/open-in-finder), выбор файлов/папок через dialog.
 */
export function registerIpcHandlers(): void {
  const ctx = getAppContext()

  ipcMain.handle('combine:parse-text', (_event, text: string) => {
    return new ParserService().parse(text)
  })

  ipcMain.handle('combine:settings:get', async () => {
    return ctx.settingsService.load(ctx.defaultOutputDir)
  })

  ipcMain.handle('combine:settings:save', async (_event, settings: AppSettings) => {
    await ctx.settingsService.save(settings)
  })

  ipcMain.handle('combine:settings:has-api-key', async () => {
    return ctx.settingsService.hasApiKey()
  })

  // issue #10: статус детальнее булева hasApiKey() — UI может показать "ключ повреждён,
  // введите заново" вместо неотличимого от "ключа нет" состояния.
  ipcMain.handle('combine:settings:api-key-status', async () => {
    return ctx.settingsService.getApiKeyStatus()
  })

  ipcMain.handle('combine:settings:is-encryption-available', () => {
    return ctx.settingsService.isEncryptionAvailable()
  })

  ipcMain.handle('combine:settings:set-api-key', async (_event, apiKey: string) => {
    await ctx.settingsService.setApiKey(apiKey)
  })

  ipcMain.handle('combine:settings:clear-api-key', async () => {
    await ctx.settingsService.clearApiKey()
  })

  // «Проверить подключение» на экране настроек: реальный (лёгкий, бесплатный) GET /v1/voices.
  ipcMain.handle('combine:settings:test-connection', async () => {
    const apiKey = await ctx.settingsService.getApiKey()
    if (!apiKey) return { ok: false, message: 'API-ключ не задан.' }
    try {
      const service = new ElevenLabsService({ apiKey, maxRetries: 0 })
      const voices = await service.listVoices()
      return { ok: true, message: `Подключение активно (${voices.length} голосов доступно).` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('combine:voices:list', async (_event, provider: 'mock_say' | 'elevenlabs') => {
    const service = await resolveProviderForListing(provider)
    return service.listVoices()
  })

  ipcMain.handle('combine:models:list', async (_event, provider: 'mock_say' | 'elevenlabs') => {
    const service = await resolveProviderForListing(provider)
    return service.listModels()
  })

  // D-05: «Тестовая генерация» — один TTS-запрос вне очереди, для проверки ключа/голоса.
  ipcMain.handle('combine:test-generate', async (_event, params: TestGenerationParams) => {
    return runTestGeneration(params)
  })

  ipcMain.handle('combine:generation:start', async (_event, params: { inputText: string; settings: AppSettings }) => {
    // Лёгкая защита (не строгое совпадение с сохранёнными настройками — здесь легитимно писать
    // в ЕЩЁ НЕ сохранённую папку, которую пользователь только что выбрал/поменял в UI перед тем,
    // как нажать «Сгенерировать»): просто отвергаем катастрофически широкие корни.
    assertSaneOutputRoot(params.settings.outputDir)
    return generationSession.start(params, (progress) => {
      getCurrentWindow()?.webContents.send('combine:generation:progress', progress)
    })
  })

  ipcMain.handle(
    'combine:generation:regenerate',
    async (
      _event,
      params: { topicId: string; outputRoot: string; mode: 'all' | 'failed'; queueConfig: QueueConfig; pricePerThousandChars: Record<string, number> }
    ) => {
      const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
      const outputRoot = assertKnownOutputRoot(params.outputRoot, settings.outputDir)
      await generationSession.startRegenerate({ ...params, outputRoot }, (progress) => {
        getCurrentWindow()?.webContents.send('combine:generation:progress', progress)
      })
    }
  )

  ipcMain.handle('combine:generation:pause', () => generationSession.pause())
  ipcMain.handle('combine:generation:resume', () => generationSession.resume())
  ipcMain.handle('combine:generation:cancel', () => generationSession.cancel())
  ipcMain.handle('combine:generation:is-active', () => generationSession.isActive())

  ipcMain.handle('combine:library:list', async (_event, outputRoot: string) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const confined = assertKnownOutputRoot(outputRoot, settings.outputDir)
    return ctx.fileService.listLessons(confined)
  })

  ipcMain.handle('combine:library:delete', async (_event, params: { outputRoot: string; topicId: string }) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const outputRoot = assertKnownOutputRoot(params.outputRoot, settings.outputDir)
    await ctx.fileService.deleteLesson(outputRoot, params.topicId)
  })

  ipcMain.handle('combine:library:export-zip', async (_event, params: { outputRoot: string; topicId: string }) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const outputRoot = assertKnownOutputRoot(params.outputRoot, settings.outputDir)
    const zipPath = ctx.fileService.defaultZipPath(outputRoot, params.topicId)
    await ctx.fileService.exportZip(outputRoot, params.topicId, zipPath)
    return { zipPath }
  })

  ipcMain.handle('combine:library:open-in-finder', async (_event, params: { outputRoot: string; topicId: string }) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const outputRoot = assertKnownOutputRoot(params.outputRoot, settings.outputDir)
    shell.showItemInFolder(ctx.fileService.lessonDir(outputRoot, params.topicId))
  })

  ipcMain.handle('combine:pick-output-dir', async () => {
    const win = getCurrentWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('combine:pick-input-file', async () => {
    const win = getCurrentWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Текст урока', extensions: ['txt', 'md'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0]
  })

  registerFlatApiHandlers(ctx)
}

async function resolveProviderForListing(providerName: Provider, explicitApiKey?: string | null): Promise<TTSProvider> {
  if (providerName === 'mock_say') return new MockSayService()
  const apiKey = explicitApiKey && explicitApiKey.trim().length > 0 ? explicitApiKey : await getAppContext().settingsService.getApiKey()
  if (!apiKey) throw new Error('API-ключ ElevenLabs не задан.')
  return new ElevenLabsService({ apiKey, maxRetries: 1 })
}

function forwardProgress(progress: GenerationProgressEvent): void {
  getCurrentWindow()?.webContents.send('combine:generation:progress', progress)
}

/**
 * Плоский контракт `window.combineApi` (src/shared/ipc.ts#CombineIpcApi) поверх ТЕХ ЖЕ main-сервисов,
 * что и вложенный `window.combine` выше — см. docs/DECISIONS.md D-22 для общей схемы стыковки.
 * Отдельное пространство каналов `combine:api:*`, чтобы не конфликтовать с уже зарегистрированными
 * `combine:settings:*`/`combine:generation:*`/`combine:library:*`/... (ipcMain.handle бросает при
 * повторной регистрации канала — см. докстринг registerIpcHandlers()). Операции контракта, чья форма
 * УЖЕ совпадает 1:1 с существующими каналами (parseText, getSettings, saveSettings, pause/resume/
 * cancelGeneration, onGenerationProgress — 7 из 19), переиспользуются напрямую из preload
 * (src/preload/index.ts) без добавления сюда нового хендлера; здесь — оставшиеся 12, чья форма
 * отличается (другие поля входа/выхода, явный apiKey вместо чтения из secure storage, outputRoot
 * резолвится из настроек вместо явного параметра и т.п.).
 */
function registerFlatApiHandlers(ctx: ReturnType<typeof getAppContext>): void {
  ipcMain.handle('combine:api:test-connection', async (_event, input: TestConnectionInput) => {
    if (input.provider === 'mock_say') {
      const voices = await new MockSayService().listVoices()
      return { ok: true, message: 'Mock-провайдер (macOS say) всегда доступен — реальный API-ключ не требуется.', voiceCount: voices.length }
    }
    const apiKey = input.apiKey && input.apiKey.trim().length > 0 ? input.apiKey : await ctx.settingsService.getApiKey()
    if (!apiKey) return { ok: false, message: 'API-ключ не задан.' }
    try {
      const service = new ElevenLabsService({ apiKey, maxRetries: 0 })
      const voices = await service.listVoices()
      return { ok: true, message: `Подключение активно (${voices.length} голосов доступно).`, voiceCount: voices.length }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('combine:api:list-voices', async (_event, input: ListVoicesInput) => {
    const service = await resolveProviderForListing(input.provider, input.apiKey)
    return service.listVoices()
  })

  ipcMain.handle('combine:api:estimate-cost', (_event, input: EstimateCostInput) => {
    const calculator = new CostCalculator(input.pricePerThousandChars)
    const estimate = calculator.estimate(input.charactersEs, input.charactersRu, input.model)
    return {
      totalCharacters: estimate.totalCharacters,
      pricePerThousand: estimate.pricePerThousandChars,
      estimatedCostUsd: estimate.costUsd,
      note: 'Это оценка, ±5% из-за особенностей подсчёта символов провайдера. Реальная цена уточнится после генерации.'
    }
  })

  ipcMain.handle('combine:api:start-generation', async (_event, input: StartGenerationInput) => {
    assertSaneOutputRoot(input.settings.outputDir)
    return generationSession.startParsed(input, forwardProgress)
  })

  ipcMain.handle('combine:api:list-library', async () => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    return buildLibraryEntries(settings.outputDir, ctx.fileService)
  })

  ipcMain.handle('combine:api:export-zip', async (_event, input: GenerationRunRef) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const zipPath = ctx.fileService.defaultZipPath(settings.outputDir, input.topicId)
    await ctx.fileService.exportZip(settings.outputDir, input.topicId, zipPath)
    return { zipPath }
  })

  ipcMain.handle('combine:api:regenerate-all', async (_event, input: GenerationRunRef) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    return generationSession.startRegenerate(
      { topicId: input.topicId, outputRoot: settings.outputDir, mode: 'all', queueConfig: settings.queue, pricePerThousandChars: settings.pricePerThousandChars },
      forwardProgress
    )
  })

  ipcMain.handle('combine:api:regenerate-failed', async (_event, input: GenerationRunRef) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    return generationSession.startRegenerate(
      { topicId: input.topicId, outputRoot: settings.outputDir, mode: 'failed', queueConfig: settings.queue, pricePerThousandChars: settings.pricePerThousandChars },
      forwardProgress
    )
  })

  ipcMain.handle('combine:api:delete-lesson', async (_event, input: GenerationRunRef) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    await ctx.fileService.deleteLesson(settings.outputDir, input.topicId)
  })

  ipcMain.handle('combine:api:open-lesson-folder', async (_event, input: GenerationRunRef) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    shell.showItemInFolder(ctx.fileService.lessonDir(settings.outputDir, input.topicId))
  })

  ipcMain.handle('combine:api:test-snippet', async (_event, input: TestSnippetInput) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const result = await runTestGeneration({
      text: input.text,
      lang: input.lang,
      provider: input.provider,
      model: input.model,
      voiceId: input.voiceId,
      stability: input.stability,
      similarityBoost: input.similarityBoost,
      pricePerThousandChars: settings.pricePerThousandChars,
      apiKey: input.apiKey
    })
    return {
      audioDataUrl: `data:audio/mpeg;base64,${result.audioBase64}`,
      durationMs: result.durationMs,
      characters: result.characters,
      costUsd: result.costUsd
    }
  })

  ipcMain.handle('combine:api:get-phrase-audio', async (_event, input: GetPhraseAudioInput) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    return readPhraseAudioDataUrl(ctx.fileService, settings.outputDir, input.topicId, input.phraseId, input.lang)
  })

  // v1.1: экспорт урока в Anki .apkg — пункт меню карточки урока в Библиотеке «Экспорт в Anki».
  ipcMain.handle('combine:api:export-anki', async (_event, input: ExportAnkiInput) => {
    const settings = await ctx.settingsService.load(ctx.defaultOutputDir)
    const lesson = await ctx.fileService.readLessonJson(settings.outputDir, input.topicId)
    const lessonDir = ctx.fileService.lessonDir(settings.outputDir, input.topicId)
    const destApkg = defaultApkgPath(settings.outputDir, input.topicId)
    return exportLessonToAnki(lesson, lessonDir, destApkg)
  })
}
