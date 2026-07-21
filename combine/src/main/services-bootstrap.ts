import { app } from 'electron'
import { join } from 'node:path'
import { SettingsService } from '../core/settings/settings.service'
import { FileService } from '../core/file/file.service'
import { CostCalculator } from '../core/cost/cost-calculator'
import { getSharedSchemaPath } from '../core/util/paths'
import { ElectronSafeStorageEncryptor } from './electron-encryptor'

/** Собранные вместе core-сервисы + Electron-специфичные пути (userData, домашняя папка). */
export interface AppContext {
  settingsService: SettingsService
  fileService: FileService
  defaultOutputDir: string
}

let context: AppContext | null = null

export function getAppContext(): AppContext {
  if (context) return context
  const userDataDir = app.getPath('userData')
  const defaultOutputDir = join(app.getPath('home'), 'lessons')
  context = {
    settingsService: new SettingsService(userDataDir, new ElectronSafeStorageEncryptor()),
    fileService: new FileService(getSharedSchemaPath()),
    defaultOutputDir
  }
  return context
}

export function makeCostCalculator(pricePerThousandChars: Record<string, number>): CostCalculator {
  return new CostCalculator(pricePerThousandChars)
}
