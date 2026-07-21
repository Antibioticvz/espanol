import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { ParserService } from '../core/parser/parser.service'
import { MockSayService } from '../core/tts/mock-say.service'
import { ElevenLabsService } from '../core/tts/eleven-labs.service'
import type { TTSProvider } from '../core/tts/tts-provider'
import type { AppSettings } from '../core/types/settings'
import type { QueueConfig } from '../core/types/generation'
import { getAppContext } from './services-bootstrap'
import { generationSession } from './generation-session'
import { runTestGeneration, type TestGenerationParams } from './test-generation'

/**
 * Регистрирует все IPC-хендлеры main-процесса. Имена каналов ниже — рабочий вариант этого
 * агента; финальную стыковку с renderer (который строится параллельно в ветке feat/combine-ui,
 * см. коммит-сообщения) делает оркестратор при merge — сознательно не пытаемся угадать точные
 * имена оттуda.
 *
 * Операции: parseText, settings (get/save/api-key/test-connection), voices/models, testGenerate
 * (D-05 «Тестовая генерация»), generation (start/pause/resume/cancel + прогресс-события),
 * library (list/delete/export/regenerate/open-in-finder), выбор файлов/папок через dialog.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
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
    return generationSession.start(params, (progress) => {
      mainWindow.webContents.send('combine:generation:progress', progress)
    })
  })

  ipcMain.handle(
    'combine:generation:regenerate',
    async (
      _event,
      params: { topicId: string; outputRoot: string; mode: 'all' | 'failed'; queueConfig: QueueConfig; pricePerThousandChars: Record<string, number> }
    ) => {
      await generationSession.startRegenerate(params, (progress) => {
        mainWindow.webContents.send('combine:generation:progress', progress)
      })
    }
  )

  ipcMain.handle('combine:generation:pause', () => generationSession.pause())
  ipcMain.handle('combine:generation:resume', () => generationSession.resume())
  ipcMain.handle('combine:generation:cancel', () => generationSession.cancel())
  ipcMain.handle('combine:generation:is-active', () => generationSession.isActive())

  ipcMain.handle('combine:library:list', async (_event, outputRoot: string) => {
    return ctx.fileService.listLessons(outputRoot)
  })

  ipcMain.handle('combine:library:delete', async (_event, params: { outputRoot: string; topicId: string }) => {
    await ctx.fileService.deleteLesson(params.outputRoot, params.topicId)
  })

  ipcMain.handle('combine:library:export-zip', async (_event, params: { outputRoot: string; topicId: string }) => {
    const zipPath = ctx.fileService.defaultZipPath(params.outputRoot, params.topicId)
    await ctx.fileService.exportZip(params.outputRoot, params.topicId, zipPath)
    return { zipPath }
  })

  ipcMain.handle('combine:library:open-in-finder', (_event, params: { outputRoot: string; topicId: string }) => {
    shell.showItemInFolder(ctx.fileService.lessonDir(params.outputRoot, params.topicId))
  })

  ipcMain.handle('combine:pick-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('combine:pick-input-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Текст урока', extensions: ['txt', 'md'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

async function resolveProviderForListing(providerName: 'mock_say' | 'elevenlabs'): Promise<TTSProvider> {
  if (providerName === 'mock_say') return new MockSayService()
  const apiKey = await getAppContext().settingsService.getApiKey()
  if (!apiKey) throw new Error('API-ключ ElevenLabs не задан.')
  return new ElevenLabsService({ apiKey, maxRetries: 1 })
}
