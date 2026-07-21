import { resolve, sep } from 'node:path'
import { homedir } from 'node:os'

const DANGEROUS_ROOTS = new Set([resolve('/'), resolve(homedir())])

/**
 * Базовая защита от катастрофически широких путей вывода (корень ФС, сам $HOME без подпапки).
 * topicId уже ограничен паттерном схемы (см. FileService.assertSafeTopicId), но ДО этого фикса
 * сам outputRoot, приходящий из renderer, ничем не был ограничен — join(outputRoot, topicId)
 * с произвольным outputRoot превращал deleteLesson()/exportZip() в rm -rf/чтение произвольного
 * пути на диске под видом "папки уроков" (issue #7 второго раунда ревью).
 */
export function assertSaneOutputRoot(outputRoot: string): string {
  const resolved = resolve(outputRoot)
  if (!resolved || resolved === sep || DANGEROUS_ROOTS.has(resolved)) {
    throw new Error(`Недопустимая папка вывода: «${outputRoot}».`)
  }
  return resolved
}

/**
 * Для операций над УЖЕ СУЩЕСТВУЮЩИМИ уроками (библиотека: list/delete/export/open-in-finder) —
 * outputRoot, присланный renderer'ом, обязан совпадать с текущей сохранённой в настройках папкой
 * вывода, а не быть произвольным путём. Так баг (или скомпрометированный renderer) не может
 * подсунуть чужой путь под видом "папки уроков" — единственный источник истины здесь main-процесс
 * (SettingsService), а не то, что renderer СЧИТАЕТ текущей папкой.
 */
export function assertKnownOutputRoot(outputRoot: string, persistedOutputDir: string): string {
  const resolved = assertSaneOutputRoot(outputRoot)
  const resolvedPersisted = resolve(persistedOutputDir)
  if (resolved !== resolvedPersisted) {
    throw new Error(
      `Папка «${outputRoot}» не совпадает с текущей папкой вывода в настройках («${persistedOutputDir}») — операция отклонена.`
    )
  }
  return resolved
}
