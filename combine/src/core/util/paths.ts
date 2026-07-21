import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * Абсолютный путь к shared/lesson.schema.json — контракту lesson.json (D-15: монорепо,
 * combine/ лежит рядом с shared/ на уровне корня worktree). Используется и main-процессом,
 * и CLI, и тестами FileService — единая точка вычисления, чтобы не дублировать "../../../../".
 */
export function getSharedSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../../shared/lesson.schema.json')
}
