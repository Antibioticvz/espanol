import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { FileService, LessonNotCompleteError } from '../../core/file/file.service'
import { getSharedSchemaPath } from '../../core/util/paths'
import { boolFlag, strFlag, type CliFlags } from '../args'

/**
 * `cli export --lesson <папка_урока> [--out <файл.zip>] [--allow-incomplete]` — экспорт уже
 * сгенерированного урока в ZIP (D-10).
 *
 * Мульти-верификаторное ревью: раньше экспорт паковал lesson.json + audio/** как есть, без
 * проверки статусов элементов — частично сгенерированный урок (обычный итог прерванного batch/
 * сбоя API на середине, см. D-22) давал ZIP, "успешно" созданный (код 0), но со ссылками на mp3,
 * которых в архиве физически нет (iOS не сможет их прочитать). Теперь по умолчанию отказываем —
 * FileService.assertLessonComplete() (используется и здесь, и в main/ipc-handlers.ts — единая
 * проверка, а не дублирование в двух местах). --allow-incomplete явно разрешает экспорт как есть
 * (напр. чтобы посмотреть частичный результат вручную).
 */
export async function runExport(flags: CliFlags): Promise<number> {
  const lessonDirFlag = strFlag(flags, 'lesson')
  if (!lessonDirFlag) {
    console.error('Использование: export --lesson <папка_урока> [--out <файл.zip>] [--allow-incomplete]')
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

  const allowIncomplete = boolFlag(flags, 'allow-incomplete')
  const lessonJson = await fileService.readLessonJson(outputRoot, topicId)
  if (!allowIncomplete) {
    try {
      fileService.assertLessonComplete(lessonJson)
    } catch (e) {
      if (e instanceof LessonNotCompleteError) {
        console.error(
          `${e.message} Если действительно нужен частичный архив (напр. для отладки), повторите с --allow-incomplete.`
        )
        return 1
      }
      throw e
    }
  }

  const destZip = strFlag(flags, 'out') ? resolve(strFlag(flags, 'out')!) : fileService.defaultZipPath(outputRoot, topicId)
  await fileService.exportZip(outputRoot, topicId, destZip)
  console.log(`ZIP создан: ${destZip}`)
  if (allowIncomplete) {
    const summary = fileService.summarize(lessonJson, 0)
    if (summary.failedItems > 0 || summary.doneItems < summary.totalItems) {
      console.log(`⚠ Внимание: урок неполный (${summary.doneItems}/${summary.totalItems} done) — экспортирован из-за --allow-incomplete.`)
    }
  }
  return 0
}
