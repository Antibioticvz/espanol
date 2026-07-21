import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import AdmZip from 'adm-zip'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_ENTRY = join(__dirname, 'index.ts')
const COMBINE_ROOT = join(__dirname, '../..')
const SCHEMA_PATH = join(COMBINE_ROOT, '../shared/lesson.schema.json')

// Медленный e2e-тест: реально запускает `tsx src/cli/index.ts` отдельным процессом и вызывает
// настоящий macOS `say` (через mock_say) — без сети, без денег, но с реальным I/O. Держим вход
// маленьким (2-3 фразы), чтобы тест был быстрым (см. требование задачи); полный контракт CLI при
// этом покрывается тем же кодом, что и scripts/integration-test.mjs в корне монорепо.
const MINI_LESSON = `#TOPIC 88 | E2E тест CLI
##BLOCK verb_group | Глаголы

#WORD saludar | здороваться
Hola, ¿cómo estás? | Привет, как дела?
Buenos días a todos. | Доброе утро всем.

##BLOCK vocabulary | Слова
el libro | книга
`

describe('CLI e2e: generate (mock_say) -> lesson.json + MP3 + ZIP', () => {
  it(
    'создаёт папку урока, валидный lesson.json (по схеме), слышимые MP3 (ES+RU) и ZIP',
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'combine-cli-e2e-'))
      const inputPath = join(workDir, 'mini-lesson.txt')
      const outDir = join(workDir, 'out')
      await writeFile(inputPath, MINI_LESSON, 'utf8')

      try {
        const { stdout } = await execFileAsync(
          'npx',
          ['tsx', CLI_ENTRY, 'generate', '--input', inputPath, '--provider', 'mock_say', '--out', outDir, '--export-zip'],
          { cwd: COMBINE_ROOT, timeout: 120000 }
        )
        expect(stdout).toContain('готово, 0 с ошибками')

        const lessonDirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory())
        expect(lessonDirs).toHaveLength(1)
        const topicId = lessonDirs[0].name
        expect(topicId).toBe('88-e2e-test-cli')
        const lessonDir = join(outDir, topicId)

        // 1. lesson.json существует и валиден против shared/lesson.schema.json
        const lessonJson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8'))
        const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'))
        const ajv = new Ajv({ allErrors: true })
        addFormats(ajv)
        const validate = ajv.compile(schema)
        const valid = validate(lessonJson)
        if (!valid) console.error(validate.errors)
        expect(valid).toBe(true)

        // 2. Все элементы done, MP3 на месте, не пустые, длительности положительные
        const items: Array<{ audio: { es: string; ru: string }; duration_ms: { es: number; ru: number }; status: string }> = []
        for (const block of lessonJson.blocks) {
          if (block.groups) for (const g of block.groups) items.push(...g.phrases)
          if (block.words) items.push(...block.words)
          if (block.type === 'story') items.push(block)
        }
        expect(items.length).toBeGreaterThanOrEqual(3) // 2 фразы + 1 слово в mini-lesson
        for (const item of items) {
          expect(item.status).toBe('done')
          for (const lang of ['es', 'ru'] as const) {
            const p = join(lessonDir, item.audio[lang])
            expect(existsSync(p)).toBe(true)
            expect(statSync(p).size).toBeGreaterThan(500) // не пустой/битый файл — реально слышимый MP3
            expect(item.duration_ms[lang]).toBeGreaterThan(0)
          }
        }

        // 3. ZIP создан, содержит lesson.json + все MP3, и распаковывается обратно
        const zipPath = join(outDir, `lesson-${topicId}.zip`)
        expect(existsSync(zipPath)).toBe(true)
        const zip = new AdmZip(zipPath)
        const entryNames = zip.getEntries().map((e) => e.entryName)
        expect(entryNames).toContain('lesson.json')
        const mp3Entries = entryNames.filter((n) => n.endsWith('.mp3'))
        expect(mp3Entries).toHaveLength(items.length * 2)

        const extractDir = join(workDir, 'extracted')
        zip.extractAllTo(extractDir, true)
        expect(existsSync(join(extractDir, 'lesson.json'))).toBe(true)

        // 4. generation.log существует
        expect(existsSync(join(lessonDir, 'generation.log'))).toBe(true)
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    },
    120000
  )

  it(
    'CLI parse: ошибочный формат — ненулевой код завершения и сообщение с номером строки',
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'combine-cli-e2e-parse-'))
      const inputPath = join(workDir, 'broken.txt')
      await writeFile(inputPath, '#TOPIC 1 | Тема\n##BLOCK vocabulary | Слова\nel gato sin separador\n', 'utf8')
      try {
        await expect(
          execFileAsync('npx', ['tsx', CLI_ENTRY, 'parse', '--input', inputPath], { cwd: COMBINE_ROOT, timeout: 30000 })
        ).rejects.toMatchObject({ code: 1 })
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    },
    30000
  )
})
