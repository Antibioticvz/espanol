import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { runGenerate } from './generate'

/**
 * Пакетный режим `generate --input <папка>` (D-22, docs/DECISIONS.md): 2 валидные мини-темы
 * (2-3 фразы каждая) + 1 битый файл (фраза без разделителя "|") в одной папке. Вызывает
 * runGenerate() напрямую (не через дочерний процесс, в отличие от cli.e2e.test.ts) — быстрее и
 * достаточно, т.к. per-file dispatch/агрегация сводки — это логика САМОГО generate.ts, а не CLI
 * argv-парсинга (тот уже покрыт cli.torture.test.ts/cli.e2e.test.ts). provider=mock_say — реальный
 * (бесплатный, локальный) MockSayService, как и остальные тесты генерации в этом репо (CLAUDE.md
 * правило №1 — никогда не вызывать платный ElevenLabs API из тестов).
 */
const TOPIC_A = `#TOPIC 60 | Мини-тема А
##BLOCK vocabulary | Слова
el sol | солнце
la luna | луна
`

const TOPIC_B = `#TOPIC 61 | Мини-тема Б
##BLOCK vocabulary | Слова
el mar | море
la playa | пляж
la arena | песок
`

const BROKEN = `#TOPIC 62 | Битая тема
##BLOCK vocabulary | Слова
el gato sin separador
`

describe('runGenerate — пакетный режим (--input папка), D-22', () => {
  let workDir: string
  let inputDir: string
  let outDir: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-batch-cli-'))
    inputDir = join(workDir, 'in')
    outDir = join(workDir, 'out')
    await mkdir(inputDir, { recursive: true })
    // Имена начинаются с цифр — гарантирует алфавитный порядок 01 -> 02 -> 03 (broken последним),
    // хотя сама функция терпима к порядку (ошибка НЕ прерывает остальные независимо от позиции).
    await writeFile(join(inputDir, '01-a.txt'), TOPIC_A, 'utf8')
    await writeFile(join(inputDir, '02-b.txt'), TOPIC_B, 'utf8')
    await writeFile(join(inputDir, '03-broken.txt'), BROKEN, 'utf8')
    // Файл без .txt — должен быть проигнорирован, а не сломать сканирование папки.
    await writeFile(join(inputDir, 'README.md'), '# not a lesson', 'utf8')

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    await rm(workDir, { recursive: true, force: true })
  })

  it(
    '2 успеха + 1 ошибка (битый файл), ненулевой код возврата, обе успешные темы валидны на диске',
    async () => {
      const code = await runGenerate({ input: inputDir, provider: 'mock_say', out: outDir })

      expect(code).toBe(1)

      const lessonDirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory())
      expect(lessonDirs).toHaveLength(2)

      for (const dirEntry of lessonDirs) {
        const lessonDir = join(outDir, dirEntry.name)
        const lessonJson = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8'))
        expect(lessonJson.stats.vocab_count).toBeGreaterThan(0)
        const words: Array<{ id: string; status: string; audio: { es: string; ru: string } }> = lessonJson.blocks[0].words
        expect(words.length).toBeGreaterThan(0)
        for (const w of words) {
          expect(w.status).toBe('done')
          for (const lang of ['es', 'ru'] as const) {
            const p = join(lessonDir, w.audio[lang])
            expect(existsSync(p)).toBe(true)
            expect(statSync(p).size).toBeGreaterThan(500)
          }
        }
      }

      // Битая тема НЕ создала папку урока (парсер отбраковал её до записи lesson.json).
      const dirNames = lessonDirs.map((d) => d.name)
      expect(dirNames.some((n) => n.includes('62'))).toBe(false)

      const output = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => String(args[0])).join('\n')
      expect(output).toContain('Пакетная генерация: 3 файл(ов)')
      expect(output).toContain('Успешно: 2/3, с ошибками: 1/3')
      expect(output).toMatch(/✗ 03-broken\.txt.*код 1/)
    },
    60000
  )

  it('--export-zip применяется к КАЖДОЙ успешной теме в пакете', async () => {
    const code = await runGenerate({ input: inputDir, provider: 'mock_say', out: outDir, 'export-zip': true })
    expect(code).toBe(1) // всё ещё частичный провал из-за битого файла

    const lessonDirs = (await readdir(outDir, { withFileTypes: true })).filter((d) => d.isDirectory())
    expect(lessonDirs).toHaveLength(2)

    const zipFiles = (await readdir(outDir)).filter((f) => f.endsWith('.zip'))
    expect(zipFiles).toHaveLength(2)
    for (const zipFile of zipFiles) {
      const zip = new AdmZip(join(outDir, zipFile))
      const entryNames = zip.getEntries().map((e) => e.entryName)
      expect(entryNames).toContain('lesson.json')
    }
  }, 60000)

  it('одиночный файл (не папка) продолжает работать как раньше — без сводки пакетного режима', async () => {
    const code = await runGenerate({ input: join(inputDir, '01-a.txt'), provider: 'mock_say', out: outDir })
    expect(code).toBe(0)
    const output = logSpy.mock.calls.map((args) => String(args[0])).join('\n')
    expect(output).not.toContain('Пакетная генерация')
    expect(output).toContain('готово, 0 с ошибками')
  }, 30000)

  it('папка без .txt файлов -> код 1, внятное сообщение', async () => {
    const emptyDir = join(workDir, 'empty')
    await mkdir(emptyDir, { recursive: true })
    const code = await runGenerate({ input: emptyDir, provider: 'mock_say', out: outDir })
    expect(code).toBe(1)
    const output = errorSpy.mock.calls.map((args) => String(args[0])).join('\n')
    expect(output).toContain('не найдено файлов .txt')
  })

  it('РЕГРЕССИЯ (мульти-верификаторное ревью): коллизия topic_id внутри одного batch-прогона — второй файл помечается ошибкой, а не молча "резюмирует" первый', async () => {
    const dupDir = join(workDir, 'dup-in')
    await mkdir(dupDir, { recursive: true })
    // Оба файла дают ОДИНАКОВЫЙ topic_id (номер+название темы совпадают) — типичный сценарий:
    // скопированный черновик с забытым заголовком.
    const DUP_1 = `#TOPIC 63 | Дубликат темы\n##BLOCK vocabulary | Слова\nel perro | собака\n`
    const DUP_2 = `#TOPIC 63 | Дубликат темы\n##BLOCK vocabulary | Слова\nla casa | дом\n`
    await writeFile(join(dupDir, '01-first.txt'), DUP_1, 'utf8')
    await writeFile(join(dupDir, '02-second.txt'), DUP_2, 'utf8')

    const dupOutDir = join(workDir, 'dup-out')
    const code = await runGenerate({ input: dupDir, provider: 'mock_say', out: dupOutDir })

    expect(code).toBe(1) // частичный провал — второй файл конфликтует с первым

    const lessonDirs = (await readdir(dupOutDir, { withFileTypes: true })).filter((d) => d.isDirectory())
    expect(lessonDirs).toHaveLength(1) // ровно ОДНА папка урока — от первого файла

    const lessonJson = JSON.parse(await readFile(join(dupOutDir, lessonDirs[0].name, 'lesson.json'), 'utf8'))
    // Содержимое — от ПЕРВОГО файла (el perro/собака), второй не подмешался и не подменил его молча.
    expect(lessonJson.blocks[0].words[0].es).toBe('el perro')

    const output = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => String(args[0])).join('\n')
    expect(output).toContain('уже обработан другим файлом в этом запуске')
  }, 30000)

  it('РЕГРЕССИЯ (мульти-верификаторное ревью): Ctrl+C (SIGINT) прерывает ВЕСЬ batch, а не только текущую тему', async () => {
    const sigintDir = join(workDir, 'sigint-in')
    await mkdir(sigintDir, { recursive: true })
    // 3 темы — достаточно "долгие" (реальный `say`+lamejs не мгновенен), чтобы SIGINT гарантированно
    // застал первую тему ещё обрабатывающейся, а не уже завершившейся к моменту сигнала.
    const T1 = `#TOPIC 64 | Тема раз\n##BLOCK vocabulary | Слова\nel uno | один\nel dos | два\nel tres | три\n`
    const T2 = `#TOPIC 65 | Тема два\n##BLOCK vocabulary | Слова\nel cuatro | четыре\n`
    const T3 = `#TOPIC 66 | Тема три\n##BLOCK vocabulary | Слова\nel cinco | пять\n`
    await writeFile(join(sigintDir, '01.txt'), T1, 'utf8')
    await writeFile(join(sigintDir, '02.txt'), T2, 'utf8')
    await writeFile(join(sigintDir, '03.txt'), T3, 'utf8')

    const sigintOutDir = join(workDir, 'sigint-out')
    const runPromise = runGenerate({ input: sigintDir, provider: 'mock_say', out: sigintOutDir })
    // Даём первой теме время реально начать генерацию, затем эмитируем ТОТ ЖЕ сигнал, что послал бы
    // Ctrl+C в терминале — process.on('SIGINT', ...) не различает источник события.
    await new Promise((resolve) => setTimeout(resolve, 150))
    process.emit('SIGINT')

    const code = await runPromise
    expect(code).not.toBe(0)

    const dirs = (await readdir(sigintOutDir, { withFileTypes: true })).filter((d) => d.isDirectory())
    // РАНЬШЕ: один Ctrl+C ставил на паузу ТОЛЬКО текущую тему, цикл продолжал остальные — все 3
    // темы обрабатывались бы полностью. ТЕПЕРЬ второй и третий файл не должны обработаться вовсе.
    expect(dirs.length).toBeLessThan(3)
  }, 30000)
})
