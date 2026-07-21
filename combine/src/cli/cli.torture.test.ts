import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * CLI smoke-тесты (torture-набор, D-10): реально запускает `npm run cli -- parse ...` отдельным
 * процессом (то же, что `tsx src/cli/index.ts parse ...`, см. package.json#scripts.cli) на
 * настоящих файлах курса. Дополняет combine/src/cli/cli.e2e.test.ts (который гоняет generate
 * с mock_say и один battle-tested случай parse битого файла) — здесь фокус именно на
 * "parse --input" смоуках, требуемых задачей тест-инженера, плюс кросс-чек golden-счётчиков
 * через реальный CLI-процесс (не только напрямую через ParserService, как в parser.torture.test.ts).
 */

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const COMBINE_ROOT = join(__dirname, '../..')
const COURSE_DIR = join(COMBINE_ROOT, '../shared/course')
const SAMPLE_DIR = join(COMBINE_ROOT, '../shared/sample-lessons')

interface ExecError {
  code?: number
  stdout?: string
  stderr?: string
}

describe('CLI smoke: `npm run cli -- parse` на реальных файлах курса', () => {
  it(
    'topic-03.txt (валидный) -> код возврата 0, вменяемый вывод со счётчиками',
    async () => {
      const inputPath = join(COURSE_DIR, 'topic-03.txt')
      const { stdout } = await execFileAsync('npm', ['run', 'cli', '--', 'parse', '--input', inputPath], {
        cwd: COMBINE_ROOT,
        timeout: 30000
      })
      expect(stdout).toContain('Ошибок: 0')
      expect(stdout).toContain('Статус: готово к генерации.')
      expect(stdout).toContain('Фраз: 84')
      expect(stdout).toContain('Слов (vocabulary): 14')
      expect(stdout).toContain('Рассказов: 1')
    },
    30000
  )

  it(
    'битый файл (фраза без разделителя "|") -> ненулевой код возврата, сообщение с номером строки в выводе',
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'combine-cli-torture-'))
      const inputPath = join(workDir, 'broken.txt')
      await writeFile(inputPath, '#TOPIC 1 | Тема\n##BLOCK vocabulary | Слова\nel gato sin separador\n', 'utf8')
      try {
        let caught: ExecError | undefined
        try {
          await execFileAsync('npm', ['run', 'cli', '--', 'parse', '--input', inputPath], { cwd: COMBINE_ROOT, timeout: 30000 })
        } catch (e) {
          caught = e as ExecError
        }
        expect(caught).toBeDefined()
        expect(caught?.code).toBe(1)
        expect(caught?.stdout ?? '').toContain('строка 3')
        expect(caught?.stdout ?? '').toContain('Статус: есть ошибки, генерация невозможна.')
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    },
    30000
  )

  it(
    'golden кросс-чек через реальный CLI-процесс на курсовых и sample-файлах (не только напрямую через ParserService)',
    async () => {
      const cases: Array<{ file: string; phrase: number; vocab: number; story: number }> = [
        { file: join(COURSE_DIR, 'topic-02.txt'), phrase: 73, vocab: 0, story: 0 },
        { file: join(COURSE_DIR, 'topic-04.txt'), phrase: 81, vocab: 14, story: 1 },
        { file: join(SAMPLE_DIR, 'topic-90.txt'), phrase: 21, vocab: 15, story: 1 },
        { file: join(SAMPLE_DIR, 'topic-91.txt'), phrase: 23, vocab: 13, story: 1 }
      ]
      for (const c of cases) {
        const { stdout } = await execFileAsync('npm', ['run', 'cli', '--', 'parse', '--input', c.file], {
          cwd: COMBINE_ROOT,
          timeout: 30000
        })
        expect(stdout).toContain(`Фраз: ${c.phrase}`)
        expect(stdout).toContain(`Слов (vocabulary): ${c.vocab}`)
        expect(stdout).toContain(`Рассказов: ${c.story}`)
        expect(stdout).toContain('Ошибок: 0')
      }
    },
    60000
  )

  it(
    'parse файла темы 100 (edge-case переполнения id) -> CLI всё равно завершается кодом 0 (парсер молчит о проблеме — см. parser.torture.test.ts «НАЙДЕН БАГ»)',
    async () => {
      const workDir = await mkdtemp(join(tmpdir(), 'combine-cli-torture-topic100-'))
      const inputPath = join(workDir, 'topic-100.txt')
      await writeFile(inputPath, '#TOPIC 100 | Сотая тема\n##BLOCK vocabulary | Лексика\nel gato | кот\n', 'utf8')
      try {
        const { stdout } = await execFileAsync('npm', ['run', 'cli', '--', 'parse', '--input', inputPath], {
          cwd: COMBINE_ROOT,
          timeout: 30000
        })
        // Смоук фиксирует ТЕКУЩЕЕ поведение CLI (код 0, "Ошибок: 0") — сама схема/ajv-проблема
        // документирована и разобрана в parser.torture.test.ts (там же ajv-репро и bug-репорт).
        expect(stdout).toContain('Ошибок: 0')
        expect(stdout).toContain('Статус: готово к генерации.')
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    },
    30000
  )
})
