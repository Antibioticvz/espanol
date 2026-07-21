import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Encryptor } from './encryptor'
import { UnavailableEncryptor } from './encryptor'
import { SettingsService } from './settings.service'

/** Обратимый фейковый шифровальщик для тестов — НЕ криптографически стойкий, только для проверки
 * того, что SettingsService корректно проводит данные через инжектированный Encryptor. Реальное
 * шифрование (Electron safeStorage) тестируется вручную оркестратором в приложении. */
class FakeEncryptor implements Encryptor {
  isAvailable(): boolean {
    return true
  }

  encryptToString(plainText: string): string {
    return Buffer.from(plainText, 'utf8').toString('base64')
  }

  decryptFromString(encoded: string): string {
    return Buffer.from(encoded, 'base64').toString('utf8')
  }
}

describe('SettingsService', () => {
  let userDataDir: string
  let outputDir: string

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'combine-settings-'))
    outputDir = join(tmpdir(), 'combine-fake-lessons')
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('load() без файла возвращает дефолты (provider=mock_say, чтобы работать без ключа)', async () => {
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    const settings = await service.load(outputDir)
    expect(settings.provider).toBe('mock_say')
    expect(settings.outputDir).toBe(outputDir)
    expect(settings.queue.concurrency).toBe(3)
  })

  it('save() -> load() сохраняет и восстанавливает настройки целиком', async () => {
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    const settings = await service.load(outputDir)
    settings.provider = 'elevenlabs'
    settings.model = 'eleven_flash_v2_5'
    settings.queue.concurrency = 5
    settings.pricePerThousandChars.eleven_flash_v2_5 = 0.06
    await service.save(settings)

    const reloaded = await service.load(outputDir)
    expect(reloaded.provider).toBe('elevenlabs')
    expect(reloaded.model).toBe('eleven_flash_v2_5')
    expect(reloaded.queue.concurrency).toBe(5)
    expect(reloaded.pricePerThousandChars.eleven_flash_v2_5).toBe(0.06)
  })

  it('load() сливает частично сохранённый (устаревший) settings.json с дефолтами', async () => {
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ provider: 'elevenlabs' }), 'utf8')
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    const settings = await service.load(outputDir)
    expect(settings.provider).toBe('elevenlabs')
    expect(settings.queue.concurrency).toBe(3) // не потерялось из дефолтов
    expect(settings.pricePerThousandChars.macos_say).toBe(0)
  })

  it('load() не падает на повреждённом settings.json — использует дефолты', async () => {
    await writeFile(join(userDataDir, 'settings.json'), '{ не json ', 'utf8')
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    const settings = await service.load(outputDir)
    expect(settings.provider).toBe('mock_say')
  })

  it('РЕГРЕССИЯ: повреждённый settings.json переименовывается в .bak, а не исчезает молча', async () => {
    const settingsPath = join(userDataDir, 'settings.json')
    await writeFile(settingsPath, '{ битый json', 'utf8')
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    await service.load(outputDir)

    expect(existsSync(settingsPath)).toBe(false) // исходный файл переименован, не удалён и не перезаписан
    const backup = await readFile(`${settingsPath}.bak`, 'utf8')
    expect(backup).toBe('{ битый json')
  })

  it('API-ключ: setApiKey/getApiKey проходят через Encryptor и НЕ хранятся в открытом виде', async () => {
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    expect(await service.hasApiKey()).toBe(false)
    await service.setApiKey('sk-secret-12345')
    expect(await service.hasApiKey()).toBe(true)

    const onDisk = await import('node:fs/promises').then((fs) => fs.readFile(join(userDataDir, 'api-key.enc'), 'utf8'))
    expect(onDisk).not.toContain('sk-secret-12345') // не plaintext

    const retrieved = await service.getApiKey()
    expect(retrieved).toBe('sk-secret-12345')

    await service.clearApiKey()
    expect(await service.hasApiKey()).toBe(false)
    expect(await service.getApiKey()).toBeNull()
  })

  it('getApiKey() возвращает null, если ключ никогда не задавался', async () => {
    const service = new SettingsService(userDataDir, new FakeEncryptor())
    expect(await service.getApiKey()).toBeNull()
  })

  it('setApiKey() бросает исключение, если шифрование недоступно (UnavailableEncryptor)', async () => {
    const service = new SettingsService(userDataDir, new UnavailableEncryptor())
    await expect(service.setApiKey('sk-x')).rejects.toThrow(/[Шш]ифрование/)
    expect(service.isEncryptionAvailable()).toBe(false)
  })

  describe('getApiKeyStatus() — согласованность с hasApiKey()/getApiKey() (issue #10)', () => {
    it('"none" — файла ключа нет', async () => {
      const service = new SettingsService(userDataDir, new FakeEncryptor())
      expect(await service.getApiKeyStatus()).toBe('none')
      expect(await service.hasApiKey()).toBe(false)
    })

    it('"ok" — ключ есть и расшифровывается', async () => {
      const service = new SettingsService(userDataDir, new FakeEncryptor())
      await service.setApiKey('sk-good')
      expect(await service.getApiKeyStatus()).toBe('ok')
      expect(await service.hasApiKey()).toBe(true)
      expect(await service.getApiKey()).toBe('sk-good')
    })

    it('РЕГРЕССИЯ: "corrupted" — файл есть, но не расшифровывается; hasApiKey() теперь СОГЛАСОВАНА с getApiKey()==null (раньше hasApiKey()==true вводила UI в заблуждение)', async () => {
      const throwingEncryptor: Encryptor = {
        isAvailable: () => true,
        encryptToString: (s) => s,
        decryptFromString: () => {
          throw new Error('не удалось расшифровать (напр. другая машина/учётка)')
        }
      }
      const service = new SettingsService(userDataDir, throwingEncryptor)
      await writeFile(join(userDataDir, 'api-key.enc'), 'что-то-нерасшифровываемое', 'utf8')

      expect(await service.getApiKeyStatus()).toBe('corrupted')
      expect(await service.getApiKey()).toBeNull()
      // Ключевая проверка регрессии: hasApiKey() больше не врёт "ключ есть" в этом случае.
      expect(await service.hasApiKey()).toBe(false)
    })

    it('"encryption-unavailable" — файл есть, но шифрование сейчас недоступно', async () => {
      const service = new SettingsService(userDataDir, new FakeEncryptor())
      await service.setApiKey('sk-good')
      const unavailableService = new SettingsService(userDataDir, new UnavailableEncryptor())
      expect(await unavailableService.getApiKeyStatus()).toBe('encryption-unavailable')
      expect(await unavailableService.hasApiKey()).toBe(false)
    })
  })

  it('userDataDir создаётся автоматически при save()/setApiKey(), даже если ещё не существует', async () => {
    const freshDir = join(userDataDir, 'nested', 'userdata')
    const service = new SettingsService(freshDir, new FakeEncryptor())
    const settings = await service.load(outputDir)
    await service.save(settings)
    await service.setApiKey('sk-y')
    expect(await service.hasApiKey()).toBe(true)
  })
})
