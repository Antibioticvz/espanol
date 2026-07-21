import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultSettings, type AppSettings } from '../types/settings'
import type { Encryptor } from './encryptor'

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
    } catch {
      // Повреждённый settings.json — не валим приложение, используем дефолты.
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

  async hasApiKey(): Promise<boolean> {
    return existsSync(this.apiKeyPath())
  }

  async clearApiKey(): Promise<void> {
    await rm(this.apiKeyPath(), { force: true })
  }
}
