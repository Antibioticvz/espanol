import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { FileService } from '../../core/file/file.service'
import { getSharedSchemaPath } from '../../core/util/paths'
import { strFlag, type CliFlags } from '../args'

/** `cli export --lesson <папка_урока> [--out <файл.zip>]` — экспорт уже сгенерированного урока в ZIP (D-10). */
export async function runExport(flags: CliFlags): Promise<number> {
  const lessonDirFlag = strFlag(flags, 'lesson')
  if (!lessonDirFlag) {
    console.error('Использование: export --lesson <папка_урока> [--out <файл.zip>]')
    return 1
  }
  const lessonDir = resolve(lessonDirFlag)
  if (!existsSync(lessonDir)) {
    console.error(`Папка не найдена: ${lessonDir}`)
    return 1
  }

  const outputRoot = dirname(lessonDir)
  const topicId = basename(lessonDir)
  const fileService = new FileService(getSharedSchemaPath())

  if (!(await fileService.lessonExists(outputRoot, topicId))) {
    console.error(`В папке ${lessonDir} не найден lesson.json.`)
    return 1
  }

  const destZip = strFlag(flags, 'out') ? resolve(strFlag(flags, 'out')!) : fileService.defaultZipPath(outputRoot, topicId)
  await fileService.exportZip(outputRoot, topicId, destZip)
  console.log(`ZIP создан: ${destZip}`)
  return 0
}
