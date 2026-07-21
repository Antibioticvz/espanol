import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { FileService } from '../../core/file/file.service'
import { getSharedSchemaPath } from '../../core/util/paths'
import { defaultApkgPath, exportLessonToAnki } from '../../core/anki/anki-export.service'
import { strFlag, type CliFlags } from '../args'

/**
 * `cli export-anki --lesson <папка_урока> [--out <файл.apkg>]` — экспорт уже сгенерированного
 * урока в колоду Anki (.apkg, v1.1). Карточки из ВСЕХ фраз+слов (story пропускается — см.
 * core/anki/anki-export.service.ts). Без нативных зависимостей (sql.js/WASM для SQLite).
 */
export async function runExportAnki(flags: CliFlags): Promise<number> {
  const lessonDirFlag = strFlag(flags, 'lesson')
  if (!lessonDirFlag) {
    console.error('Использование: export-anki --lesson <папка_урока> [--out <файл.apkg>]')
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

  try {
    const lesson = await fileService.readLessonJson(outputRoot, topicId)
    const destApkg = strFlag(flags, 'out') ? resolve(strFlag(flags, 'out')!) : defaultApkgPath(outputRoot, topicId)
    const result = await exportLessonToAnki(lesson, lessonDir, destApkg)
    console.log(`Anki .apkg создан: ${result.apkgPath}`)
    console.log(`Карточек: ${result.noteCount}, media-файлов: ${result.mediaCount}`)
    return 0
  } catch (e) {
    console.error(`Не удалось экспортировать в Anki: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
