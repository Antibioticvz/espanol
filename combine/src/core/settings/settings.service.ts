import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultSettings, type AppSettings } from '../types/settings'
import type { Encryptor } from './encryptor'

/** Статус API-ключа — различает "нет ключа" от "ключ есть, но повреждён/не расшифровывается" (issue #10). */
export type ApiKeyStatus = 'none' | 'ok' | 'corrupted' | 'encryption-unavailable'

/**
 * SettingsService — настройки в userData/settings.json (JSON, обычные настройки),
 * API-ключ ОТДЕЛЬНО в userData/api-key.enc, зашифрован через инжектированный Encryptor
 * (Electron `safeStorage` в реальном приложении — см. src/main). НИКОГДА не пишет ключ
 * в открытом виде: если шифрование недоступно, setApiKey бросает исключение вместо
 * небезопасного fallback.
 *
 * Работает и в Electron main, и в CLI/тестах — не зависит от модуля 'electron' напрямую.
 */
export class SettingsService {
  constructor(
    private readonly userDataDir: string,
    private readonly encryptor: Encryptor
  ) {}

  private settingsPath(): string {
    return join(this.userDataDir, 'settings.json')
  }

  private apiKeyPath(): string {
    return join(this.userDataDir, 'api-key.enc')
  }

  async load(defaultOutputDir: string): Promise<AppSettings> {
    const defaults = createDefaultSettings(defaultOutputDir)
    if (!existsSync(this.settingsPath())) return defaults
    try {
      const raw = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as Partial<AppSettings>
      // Слияние с дефолтами — чтобы появление новых полей в будущих версиях не ломало старый файл.
      return {
        ...defaults,
        ...raw,
        queue: { ...defaults.queue, ...raw.queue },
        pricePerThousandChars: { ...defaults.pricePerThousandChars, ...raw.pricePerThousandChars }
      }
    } catch (e) {
      // Повреждённый settings.json — не валим приложение, но и не проглатываем молча (issue #9
      // второго ревью): переименовываем повреждённый файл в .bak для диагностики/восстановления
      // и явно логируем причину, прежде чем откатиться на дефолты. Раньше файл просто исчезал
      // (следующий save() перезаписывал его без следа), пользователь не понимал, куда делись
      // его настройки.
      console.warn(
        `[SettingsService] settings.json повреждён (${e instanceof Error ? e.message : String(e)}) — используются значения по умолчанию.`
      )
      try {
        const backupPath = `${this.settingsPath()}.bak`
        await rename(this.settingsPath(), backupPath)
        console.warn(`[SettingsService] Повреждённый файл сохранён как ${backupPath}.`)
      } catch (renameError) {
        console.warn(
          `[SettingsService] Не удалось сохранить резервную копию повреждённого settings.json: ${
            renameError instanceof Error ? renameError.message : String(renameError)
          }`
        )
      }
      return defaults
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await mkdir(this.userDataDir, { recursive: true })
    await writeFile(this.settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  }

  isEncryptionAvailable(): boolean {
    return this.encryptor.isAvailable()
  }

  async setApiKey(plainKey: string): Promise<void> {
    if (!this.encryptor.isAvailable()) {
      throw new Error(
        'Шифрование (Electron safeStorage) недоступно на этой платформе/сборке — API-ключ не может быть сохранён без него.'
      )
    }
    await mkdir(this.userDataDir, { recursive: true })
    const encoded = this.encryptor.encryptToString(plainKey)
    await writeFile(this.apiKeyPath(), encoded, 'utf8')
  }

  async getApiKey(): Promise<string | null> {
    if (!existsSync(this.apiKeyPath())) return null
    if (!this.encryptor.isAvailable()) return null
    const encoded = await readFile(this.apiKeyPath(), 'utf8')
    try {
      return this.encryptor.decryptFromString(encoded)
    } catch {
      return null
    }
  }

  /**
   * Статус ключа для UI: различает «ключа нет» от «файл есть, но не расшифровывается»
   * (напр. api-key.enc скопирован с другой машины/учётки, где safeStorage шифрует иначе —
   * decryptString() тогда бросает). hasApiKey() ниже согласована с этим: раньше hasApiKey()
   * возвращала true по одному факту существования файла, а getApiKey() параллельно тихо
   * возвращала null при ошибке расшифровки — UI показывал «ключ есть», реальные вызовы
   * ElevenLabs при этом падали с confusing «ключ не задан» (issue #10 второго ревью).
   */
  async getApiKeyStatus(): Promise<ApiKeyStatus> {
    if (!existsSync(this.apiKeyPath())) return 'none'
    if (!this.encryptor.isAvailable()) return 'encryption-unavailable'
    try {
      const encoded = await readFile(this.apiKeyPath(), 'utf8')
      this.encryptor.decryptFromString(encoded)
      return 'ok'
    } catch {
      return 'corrupted'
    }
  }

  /** true ТОЛЬКО когда ключ реально есть и расшифровывается — согласовано с getApiKey()/getApiKeyStatus(). */
  async hasApiKey(): Promise<boolean> {
    return (await this.getApiKeyStatus()) === 'ok'
  }

  async clearApiKey(): Promise<void> {
    await rm(this.apiKeyPath(), { force: true })
  }
}
