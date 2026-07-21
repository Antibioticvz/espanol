import { safeStorage } from 'electron'
import type { Encryptor } from '../core/settings/encryptor'

/**
 * Единственное место в кодовой базе, где API-ключ шифруется/расшифровывается — оборачивает
 * Electron `safeStorage` (Keychain на macOS). SettingsService не знает про Electron напрямую
 * (см. core/settings/encryptor.ts) — это позволяет тому же коду работать в CLI/тестах.
 */
export class ElectronSafeStorageEncryptor implements Encryptor {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encryptToString(plainText: string): string {
    return safeStorage.encryptString(plainText).toString('base64')
  }

  decryptFromString(encoded: string): string {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  }
}
