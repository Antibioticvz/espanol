import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGenerate } from './generate'
import { runExportAnki } from './export-anki'

/**
 * Мульти-верификаторное ревью (minor, export-anki.ts:38): раньше 0 карточек (напр. ни одна
 * фраза/слово ещё не status="done") давали "успешный" (код 0) .apkg с пустой колодой без единого
 * предупреждения. Теперь явный отказ (код 1) + предупреждение, и пустой файл не остаётся на диске.
 */
describe('runExportAnki — отказ при 0 карточках (мульти-верификаторное ревью)', () => {
  let workDir: string
  let outDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-export-anki-cli-'))
    outDir = join(workDir, 'out')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  /** Генерирует мини-урок (2 слова, mock_say) и возвращает {lessonDir, topicId}. */
  async function generateMiniLesson(topicNumber: number, titleRu: string): Promise<{ lessonDir: string; topicId: string }> {
    const inputPath = join(workDir, `topic-${topicNumber}.txt`)
    await writeFile(inputPath, `#TOPIC ${topicNumber} | ${titleRu}\n##BLOCK vocabulary | Слова\nel gato | кот\nla casa | дом\n`, 'utf8')
    const code = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
    expect(code).toBe(0)
    const dirs = await readdir(outDir, { withFileTypes: true })
    const topicId = dirs.find((d) => d.isDirectory())!.name
    return { lessonDir: join(outDir, topicId), topicId }
  }

  it('урок с готовыми карточками -> экспорт проходит, .apkg создан', async () => {
    const { lessonDir, topicId } = await generateMiniLesson(90, 'Тема с готовыми карточками')
    const code = await runExportAnki({ lesson: lessonDir })
    expect(code).toBe(0)
    expect(existsSync(join(outDir, `${topicId}.apkg`))).toBe(true)
  }, 30000)

  it('РЕГРЕССИЯ: 0 карточек (все элементы ещё pending) -> отказ (код 1), .apkg не остаётся на диске', async () => {
    const { lessonDir, topicId } = await generateMiniLesson(91, 'Тема без готовых карточек')
    const lessonJsonPath = join(lessonDir, 'lesson.json')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8'))
    for (const w of lessonJson.blocks[0].words) w.status = 'pending'
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const code = await runExportAnki({ lesson: lessonDir })
      expect(code).toBe(1)
      expect(existsSync(join(outDir, `${topicId}.apkg`))).toBe(false)
      const output = errorSpy.mock.calls.map((a) => String(a[0])).join('\n')
      expect(output).toContain('0 карточек')
    } finally {
      errorSpy.mockRestore()
    }
  }, 30000)
})
