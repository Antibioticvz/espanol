import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NodeID3 from 'node-id3'
import { runGenerate } from './generate'

/**
 * Мульти-верификаторное ревью: два независимых бага в поведении resume (lesson.json для topic_id
 * уже существует):
 *  1) generate.ts:205 — свежепарсенный .txt отбрасывался целиком, правки текста молча терялись, а
 *     сводка рапортовала полный успех. ОСОЗНАННЫЙ выбор (см. докстринг runGenerate() в generate.ts):
 *     по умолчанию поведение НЕ меняется (идемпотентность по status, не по содержимому файла — так
 *     было задумано изначально), а --merge-text явно включает сравнение/мерж текста.
 *  2) generate.ts:232 — voice/model/stability для ОСТАВШИХСЯ (pending/failed) фраз брались из
 *     ТЕКУЩИХ CLI-флагов, а не из УЖЕ СОХРАНЁННОГО lesson.json.config (D-20) — теперь всегда из
 *     сохранённого config, вне зависимости от --merge-text.
 */
describe('runGenerate — резюме существующего lesson.json (мульти-верификаторное ревью)', () => {
  let workDir: string
  let outDir: string
  let inputPath: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'combine-resume-cli-'))
    outDir = join(workDir, 'out')
    inputPath = join(workDir, 'topic.txt')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('по умолчанию (без --merge-text): правки текста в исходном .txt ИГНОРИРУЮТСЯ при резюме (документированный выбор), без падения', async () => {
    await writeFile(
      inputPath,
      '#TOPIC 70 | Тема для резюме\n##BLOCK vocabulary | Слова\nel gato | кот\nla casa | дом\n',
      'utf8'
    )
    const code1 = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
    expect(code1).toBe(0)

    // Правим RU-текст И добавляем новую фразу в ИСТОЧНИК (тот же topic_id — номер+название не менялись).
    await writeFile(
      inputPath,
      '#TOPIC 70 | Тема для резюме\n##BLOCK vocabulary | Слова\nel gato | котик\nla casa | дом\nel perro | собака\n',
      'utf8'
    )
    const code2 = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
    expect(code2).toBe(0)

    const lessonJson = JSON.parse(await readFile(join(outDir, '70-tema-dlya-rezyume', 'lesson.json'), 'utf8'))
    const words: Array<{ es: string; ru: string; status: string }> = lessonJson.blocks[0].words
    expect(words).toHaveLength(2) // "el perro" НЕ добавлен — правки источника проигнорированы
    expect(words.find((w) => w.es === 'el gato')?.ru).toBe('кот') // старый текст, не "котик"
    expect(words.every((w) => w.status === 'done')).toBe(true)
  }, 30000)

  it('с --merge-text: изменённый текст переозвучивается, новая фраза добавляется, неизменное — не трогается', async () => {
    await writeFile(
      inputPath,
      '#TOPIC 71 | Тема с мержем\n##BLOCK vocabulary | Слова\nel gato | кот\nla casa | дом\n',
      'utf8'
    )
    const code1 = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir })
    expect(code1).toBe(0)

    const lessonDir = join(outDir, '71-tema-s-merzhem')
    const before = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8'))
    const casaAudioBefore = before.blocks[0].words.find((w: { es: string }) => w.es === 'la casa').audio.es

    await writeFile(
      inputPath,
      '#TOPIC 71 | Тема с мержем\n##BLOCK vocabulary | Слова\nel gato | котик\nla casa | дом\nel perro | собака\n',
      'utf8'
    )
    const code2 = await runGenerate({ input: inputPath, provider: 'mock_say', out: outDir, 'merge-text': true })
    expect(code2).toBe(0)

    const after = JSON.parse(await readFile(join(lessonDir, 'lesson.json'), 'utf8'))
    const words: Array<{ es: string; ru: string; status: string; audio: { es: string } }> = after.blocks[0].words
    expect(words).toHaveLength(3) // "el perro" добавлен

    const gato = words.find((w) => w.es === 'el gato')
    expect(gato?.ru).toBe('котик') // текст обновлён
    expect(gato?.status).toBe('done') // и переозвучен (не завис на pending)

    const casa = words.find((w) => w.es === 'la casa')
    expect(casa?.status).toBe('done')
    expect(casa?.audio.es).toBe(casaAudioBefore) // неизменная фраза — тот же audio-путь, не тронута

    const perro = words.find((w) => w.es === 'el perro')
    expect(perro?.status).toBe('done') // новая фраза озвучена

    expect(existsSync(join(lessonDir, casa!.audio.es))).toBe(true)
  }, 30000)

  it('РЕГРЕССИЯ: резюме использует voice/model из СОХРАНЁННОГО lesson.json.config, а не из текущих CLI-флагов (D-20)', async () => {
    await writeFile(
      inputPath,
      '#TOPIC 72 | Тема голосов\n##BLOCK vocabulary | Слова\nel gato | кот\nla casa | дом\n',
      'utf8'
    )
    const code1 = await runGenerate({
      input: inputPath,
      provider: 'mock_say',
      out: outDir,
      'voice-es': 'Mónica',
      'voice-ru': 'Milena'
    })
    expect(code1).toBe(0)

    const lessonDir = join(outDir, '72-tema-golosov')
    const lessonJsonPath = join(lessonDir, 'lesson.json')
    const lessonJson = JSON.parse(await readFile(lessonJsonPath, 'utf8'))
    const gato = lessonJson.blocks[0].words.find((w: { es: string }) => w.es === 'el gato')
    gato.status = 'failed' // форсируем переозвучку именно этой фразы на следующем запуске
    gato.error = 'искусственный сбой для теста'
    await writeFile(lessonJsonPath, JSON.stringify(lessonJson), 'utf8')

    // Второй запуск — С ДРУГИМ --voice-es. Если бы бага не было исправлена, "el gato" переозвучился
    // бы голосом Milena (из ЭТОГО вызова), а не Mónica (из сохранённого config первого запуска).
    const code2 = await runGenerate({
      input: inputPath,
      provider: 'mock_say',
      out: outDir,
      'voice-es': 'Milena',
      'voice-ru': 'Milena'
    })
    expect(code2).toBe(0)

    const gatoAudioPath = join(lessonDir, 'audio', 'es', `${gato.id}.mp3`)
    const tags = await NodeID3.Promise.read(gatoAudioPath)
    expect(tags.artist).toBe('Mónica')
  }, 30000)
})
