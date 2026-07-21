import { fileURLToPath } from 'node:url'
import { dirname, resolve, sep } from 'node:path'

/**
 * Абсолютный путь к shared/lesson.schema.json — контракту lesson.json (D-15: монорепо,
 * combine/ лежит рядом с shared/ на уровне корня worktree). Используется и main-процессом,
 * и CLI, и тестами FileService — единая точка вычисления, чтобы не дублировать "../../../../".
 */
export function getSharedSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../../shared/lesson.schema.json')
}

/**
 * Мульти-верификаторное ревью (combine-api-support.ts#readPhraseAudioDataUrl,
 * anki-export.service.ts#buildAnkiPackage): оба места резолвили относительный путь к mp3 из
 * lesson.json (audio.es/audio.ru) через `join(lessonDir, ...relPath.split('/'))` БЕЗ проверки,
 * что результат остаётся внутри lessonDir — lesson.json теоретически может быть отредактирован
 * вручную (или прийти из недоверенного источника, напр. распакованный чужой ZIP) со значением
 * вида "../../../../etc/passwd", и оба потребителя честно прочитали бы и вернули байты
 * произвольного файла с диска (плеер — как data: URL в renderer, Anki-экспорт — как media-файл
 * в .apkg). Общая защита: резолвим и проверяем префикс ОДИН раз здесь, а не дублируем проверку
 * в двух местах по-разному.
 */
export function resolveWithinDir(baseDir: string, relPath: string): string {
  const base = resolve(baseDir)
  const resolved = resolve(base, ...relPath.split('/'))
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Путь «${relPath}» выходит за пределы ожидаемой директории «${base}».`)
  }
  return resolved
}
