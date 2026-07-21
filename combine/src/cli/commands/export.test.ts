import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGenerate } from './generate'
import { runExport } from './export'

/**
 * Мульти-верификаторное ревью (critical, export.ts:30): раньше `cli export` паковал lesson.json +
 * audio/** как есть, без проверки, что все элементы status='done' — частично сгенерированный урок
 * (обычный итог прерванного batch/сбоя API на середине) давал ZIP, "успешно" созданный (код 0), но
 * со ссылками на mp3, которых в архиве физически нет (см. shared/lesson.schema.json — "в
 * экспортированном ZIP все элементы должны быть done"). Теперь по умолчанию отказ,
 * --allow-incomplete разрешает явно.
 */
describe('runExport — отказ от экспорта незавершённого урока (мульти-верификаторное ревью)', () => {
  let workDir: string
  let outDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-export-cli-'))
    outDir = join(workDir, 'out')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  /** Генерирует мини-урок (2 слова, mock_say) и возвращает {lessonDir, topicId, defaultZipPath}. */
  async function generateMiniLesson(topicNumber: number, titleRu: string): Promise<{ lessonDir: string; topicId: string; zipPath: string }> {
    const inputPath = join(workDir, `topic-${topicNumber}.txt`)
    await writeFile(inputPath, `#TOPIC ${topicNumber} | ${titleRu}\n##BLOCK vocabulary | Слова\nel gato | кот\nla casa | дом\n`, 'utf8')
    const code = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
    expect(code).toBe(0)
    const dirs = await readdir(outDir, { withFileTypes: true })
    const topicId = dirs.find((d) => d.isDirectory())!.name
    return { lessonDir: join(outDir, topicId), topicId, zipPath: join(outDir, `lesson-${topicId}.zip`) }
  }

  it('урок полностью готов -> экспорт проходит как раньше', async () => {
    const { lessonDir, zipPath } = await generateMiniLesson(80, 'Тема экспорта')
    const code = await runExport({ lesson: lessonDir })
    expect(code).toBe(0)
    expect(existsSync(zipPath)).toBe(true)
  }, 30000)

  it('РЕГРЕССИЯ: урок частично сгенерирован (есть pending) -> отказ (код 1) по умолчанию, ZIP не создаётся', async () => {
    const { lessonDir, zipPath } = await generateMiniLesson(81, 'Незавершённая тема')
    const lessonJsonPath = join(lessonDir, 'lesson.json')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8'))
    lessonJson.blocks[0].words[1].status = 'pending' // симулируем недогенерированную фразу
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const code = await runExport({ lesson: lessonDir })
      expect(code).toBe(1)
      expect(existsSync(zipPath)).toBe(false)
      const output = errorSpy.mock.calls.map((a) => String(a[0])).join('\n')
      expect(output).toContain('не полностью готов')
    } finally {
      errorSpy.mockRestore()
    }
  }, 30000)

  it('РЕГРЕССИЯ: урок с failed-элементом -> отказ по умолчанию', async () => {
    const { lessonDir } = await generateMiniLesson(82, 'Тема с ошибкой')
    const lessonJsonPath = join(lessonDir, 'lesson.json')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8'))
    lessonJson.blocks[0].words[0].status = 'failed'
    lessonJson.blocks[0].words[0].error = 'искусственный сбой для теста'
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const code = await runExport({ lesson: lessonDir })
      expect(code).toBe(1)
    } finally {
      errorSpy.mockRestore()
    }
  }, 30000)

  it('--allow-incomplete разрешает экспорт частично сгенерированного урока явно', async () => {
    const { lessonDir, zipPath } = await generateMiniLesson(83, 'Тема с явным разрешением')
    const lessonJsonPath = join(lessonDir, 'lesson.json')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8'))
    lessonJson.blocks[0].words[1].status = 'pending'
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const code = await runExport({ lesson: lessonDir, 'allow-incomplete': true })
      expect(code).toBe(0)
      expect(existsSync(zipPath)).toBe(true)
      const output = logSpy.mock.calls.map((a) => String(a[0])).join('\n')
      expect(output).toContain('урок неполный')
    } finally {
      logSpy.mockRestore()
    }
  }, 30000)
})
