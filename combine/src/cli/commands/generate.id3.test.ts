import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGenerate } from './generate'

/**
 * Мульти-верификаторное ревью (минор, generate.ts:250): markId3Written() раньше проставляла
 * id3_tags_written=true для ЛЮБОЙ done-задачи при включённом --no-id3=false, даже если
 * writeId3Tags() внутри onAudioSaved реально упал (ошибка там только логируется предупреждением и
 * проглатывается) — lesson.json лгал о состоянии файла. node-id3 замокан ЦЕЛИКОМ на весь файл,
 * поэтому этот тест — в ОТДЕЛЬНОМ файле (не смешиваем с другими generate.ts-тестами, которым нужна
 * настоящая запись ID3).
 */
vi.mock('node-id3', () => ({
  default: {
    Promise: {
      write: vi.fn(async () => {
        throw new Error('искусственный сбой записи ID3 (тест)')
      })
    }
  }
}))

describe('runGenerate — markId3Written только при реальном успехе записи ID3 (мульти-верификаторное ревью)', () => {
  it('writeId3Tags() падает для КАЖДОЙ фразы -> status всё равно done, но id3_tags_written остаётся false', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'combine-id3-fail-'))
    try {
      const inputPath = join(workDir, 'topic.txt')
      const outDir = join(workDir, 'out')
      await writeFile(inputPath, '#TOPIC 73 | Тема ID3\n##BLOCK vocabulary | Слова\nel gato | кот\n', 'utf8')

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const code = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
        // Генерация аудио сама по себе успешна (ID3 — лишь метаданные поверх уже готового mp3) —
        // сбой записи тегов НЕ должен проваливать всю генерацию фразы.
        expect(code).toBe(0)

        const lessonJson = JSON.parse(await readFile(join(outDir, '73-tema-id3', 'lesson.json'), 'utf8'))
        const word = lessonJson.blocks[0].words[0]
        expect(word.status).toBe('done')
        // РАНЬШЕ: id3_tags_written становился true независимо от результата записи. ТЕПЕРЬ — false,
        // раз writeId3Tags() реально упал (см. onAudioSaved -> id3FailedPhraseIds в generate.ts).
        expect(word.id3_tags_written).toBe(false)

        const warnings = warnSpy.mock.calls.map((args) => String(args[0])).join('\n')
        expect(warnings).toMatch(/Не удалось записать ID3/)
      } finally {
        logSpy.mockRestore()
        warnSpy.mockRestore()
      }
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }, 30000)
})
