/**
 * Абстракция шифрования API-ключа — отделяет SettingsService от Electron, чтобы сервис
 * работал и в чистом Node (CLI). Реальная реализация (ElectronSafeStorageEncryptor,
 * оборачивающая `safeStorage` Electron) живёт в src/main, т.к. только там доступен модуль
 * 'electron'. CLI использует UnavailableEncryptor и никогда не хранит ключ на диске —
 * он передаётся флагом/переменной окружения при каждом запуске (см. src/cli).
 */
export interface Encryptor {
  isAvailable(): boolean
  /** Возвращает шифротекст в виде строки (напр. base64), пригодной для записи в файл. */
  encryptToString(plainText: string): string
  decryptFromString(encoded: string): string
}

export class UnavailableEncryptor implements Encryptor {
  isAvailable(): boolean {
    return false
  }

  encryptToString(): string {
    throw new Error('Шифрование недоступно в этом окружении (CLI не хранит API-ключ на диске).')
  }

  decryptFromString(): string {
    throw new Error('Шифрование недоступно в этом окружении (CLI не хранит API-ключ на диске).')
  }
}
