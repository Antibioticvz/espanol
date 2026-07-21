import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'
import { resolveWithinDir } from './paths'

/**
 * Мульти-верификаторное ревью (minor, combine-api-support.ts:108 + anki-export.service.ts:293):
 * оба места резолвили путь к аудио из lesson.json (audio.es/audio.ru) без проверки directory
 * traversal. resolveWithinDir() — общая защита, вынесенная сюда одним местом (см. docstring в
 * core/util/paths.ts).
 */
describe('resolveWithinDir — защита от directory traversal при резолве относительных путей', () => {
  it('обычный относительный путь внутри baseDir резолвится нормально', () => {
    const result = resolveWithinDir('/lessons/01-topic', 'audio/es/p1.mp3')
    expect(result).toBe(join('/lessons/01-topic', 'audio', 'es', 'p1.mp3'))
  })

  it('путь, совпадающий с самим baseDir, разрешён (граничный случай)', () => {
    expect(resolveWithinDir('/lessons/01-topic', '.')).toBe(join('/lessons/01-topic'))
  })

  it('простой "../" выход за пределы baseDir — бросает', () => {
    expect(() => resolveWithinDir('/lessons/01-topic', '../02-topic/audio/es/p1.mp3')).toThrow(/выходит за пределы/)
  })

  it('глубокий traversal до системного файла — бросает', () => {
    expect(() => resolveWithinDir('/lessons/01-topic', '../../../../../../etc/passwd')).toThrow(/выходит за пределы/)
  })

  it('абсолютный путь (лидирующий "/") трактуется как относительный сегмент, а не как побег из baseDir', () => {
    // '/etc/passwd'.split('/') -> ['', 'etc', 'passwd'] -> path.resolve игнорирует пустые сегменты,
    // так что результат остаётся ВНУТРИ baseDir (baseDir/etc/passwd), а не становится /etc/passwd.
    const result = resolveWithinDir('/lessons/01-topic', '/etc/passwd')
    expect(result.startsWith(`/lessons/01-topic${sep}`)).toBe(true)
  })

  it('соседняя папка с общим префиксом имени НЕ считается "внутри" (нет ложноположительного startsWith без учёта sep)', () => {
    // baseDir "/lessons/01-topic" и "/lessons/01-topic-evil" имеют общий строковый префикс, но
    // вторая — другая директория. Проверка на sep-границу должна это различать.
    expect(() => resolveWithinDir('/lessons/01-topic', '../01-topic-evil/audio/es/p1.mp3')).toThrow(/выходит за пределы/)
  })
})
