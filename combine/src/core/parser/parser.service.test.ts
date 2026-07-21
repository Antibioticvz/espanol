import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { ParserService } from './parser.service'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_PATH = resolve(__dirname, '../../../../shared/sample-lessons/topic-04.txt')
const COURSE_DIR = resolve(__dirname, '../../../../shared/course')

const parser = new ParserService()

describe('ParserService — образец shared/sample-lessons/topic-04.txt', () => {
  it('парсит без ошибок и даёт ожидаемые счётчики (9 фраз, 4 слова, 1 рассказ)', () => {
    const raw = readFileSync(SAMPLE_PATH, 'utf8')
    const result = parser.parse(raw)

    expect(result.errors).toEqual([])
    expect(result.lesson).not.toBeNull()
    expect(result.stats.phraseCount).toBe(9)
    expect(result.stats.vocabCount).toBe(4)
    expect(result.stats.storyCount).toBe(1)
    expect(result.stats.blockCount).toBe(4)
    expect(result.stats.totalElements).toBe(14)
    expect(result.stats.charactersEs).toBeGreaterThan(0)
    expect(result.stats.charactersRu).toBeGreaterThan(0)
    expect(result.stats.totalCharacters).toBe(result.stats.charactersEs + result.stats.charactersRu)
  })

  it('строит корректную структуру блоков/групп/id', () => {
    const raw = readFileSync(SAMPLE_PATH, 'utf8')
    const { lesson } = parser.parse(raw)
    expect(lesson?.topicNumber).toBe(4)
    expect(lesson?.titleRu).toBe('Рассказ о себе')
    expect(lesson?.topicId).toBe('04-rasskaz-o-sebe')
    expect(lesson?.blocks).toHaveLength(4)

    const [b1, b2, b3, b4] = lesson!.blocks
    expect(b1.type).toBe('verb_group')
    expect(b1.blockId).toBe('b1')
    if (b1.type === 'verb_group' || b1.type === 'phrase_group') {
      expect(b1.groups.map((g) => g.key)).toEqual(['llamarse', 'tener'])
      expect(b1.groups[0].phrases.map((p) => p.id)).toEqual([
        '04-b1-llamarse-01',
        '04-b1-llamarse-02',
        '04-b1-llamarse-03'
      ])
      expect(b1.groups[0].translationRu).toBe('зваться')
    }

    expect(b2.type).toBe('phrase_group')
    if (b2.type === 'phrase_group') {
      expect(b2.groups.map((g) => g.titleRu)).toEqual(['Первое знакомство', 'О работе'])
    }

    expect(b3.type).toBe('vocabulary')
    if (b3.type === 'vocabulary') {
      expect(b3.words).toHaveLength(4)
      expect(b3.words[0]).toMatchObject({ id: '04-b3-vocab-01', es: 'el programador', ru: 'программист' })
    }

    expect(b4.type).toBe('story')
    if (b4.type === 'story') {
      expect(b4.textEs).toContain('Me llamo Victor')
      expect(b4.textRu).toContain('Меня зовут Виктор')
    }
  })
})

describe('ParserService — YAML front-matter', () => {
  it('читает topic_id/title_es/language_variants из front-matter', () => {
    const raw = `---
topic_id: 04-custom-slug
title_es: Cuéntame sobre ti
language_variants:
  spanish_region: es-MX
  speed_multiplier: 1.2
---
#TOPIC 4 | Рассказ о себе

##BLOCK vocabulary | Лексика
el gato | кот
`
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    expect(result.lesson?.topicId).toBe('04-custom-slug')
    expect(result.lesson?.titleEs).toBe('Cuéntame sobre ti')
    expect(result.lesson?.languageVariants).toEqual({ spanishRegion: 'es-MX', speedMultiplier: 1.2 })
  })

  it('предупреждает и откатывается на автослаг при невалидном topic_id в YAML', () => {
    const raw = `---
topic_id: НЕВАЛИДНЫЙ ID!
---
#TOPIC 4 | Рассказ о себе

##BLOCK vocabulary | Лексика
el gato | кот
`
    const result = parser.parse(raw)
    expect(result.lesson?.topicId).toBe('04-rasskaz-o-sebe')
    expect(result.warnings.some((w) => w.message.includes('topic_id'))).toBe(true)
  })

  it('фатальная ошибка при незакрытом front-matter', () => {
    const raw = `---
topic_id: 04-x
#TOPIC 4 | Тема
`
    const result = parser.parse(raw)
    expect(result.lesson).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toContain('front-matter')
  })
})

describe('ParserService — ошибки формата', () => {
  it('фатально: нет #TOPIC вообще', () => {
    const raw = `##BLOCK vocabulary | Лексика\nel gato | кот\n`
    const result = parser.parse(raw)
    expect(result.lesson).toBeNull()
    expect(result.errors.some((e) => e.message.includes('#TOPIC'))).toBe(true)
  })

  it('фатально: нет ни одного валидного блока', () => {
    const raw = `#TOPIC 1 | Тема без блоков\n`
    const result = parser.parse(raw)
    expect(result.lesson).toBeNull()
    expect(result.errors.some((e) => e.message.includes('##BLOCK'))).toBe(true)
  })

  it('некорректный #TOPIC (нет разделителя |)', () => {
    const raw = `#TOPIC 4 Рассказ о себе\n##BLOCK vocabulary | Лексика\nel gato | кот\n`
    const result = parser.parse(raw)
    expect(result.lesson).toBeNull()
    expect(result.errors[0].line).toBe(1)
    expect(result.errors[0].message).toContain('#TOPIC')
  })

  it('повторный #TOPIC — вторая директива игнорируется с ошибкой', () => {
    const raw = `#TOPIC 4 | Первая тема\n#TOPIC 5 | Вторая тема\n##BLOCK vocabulary | Лексика\nel gato | кот\n`
    const result = parser.parse(raw)
    expect(result.lesson?.topicNumber).toBe(4)
    expect(result.lesson?.titleRu).toBe('Первая тема')
    expect(result.errors.some((e) => e.line === 2 && e.message.includes('Повторный #TOPIC'))).toBe(true)
  })

  it('неизвестный тип блока', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK unknown_type | Заголовок\nes | ru\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 2 && e.message.includes('Неизвестный тип блока'))).toBe(true)
  })

  it('фраза без разделителя "|" — с номером строки', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nel gato sin separador\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('без разделителя'))).toBe(true)
  })

  it('пустая часть фразы (ES или RU)', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nel gato | \n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('Пустая часть фразы'))).toBe(true)
  })

  it('текст до объявления блока', () => {
    const raw = `#TOPIC 1 | Тема\nel gato | кот\n##BLOCK vocabulary | Лексика\nel perro | собака\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 2 && e.message.includes('до объявления ##BLOCK'))).toBe(true)
    expect(result.stats.vocabCount).toBe(1)
  })

  it('фраза до заголовка группы в verb_group', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\nMe llamo Victor. | Меня зовут Виктор.\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('до заголовка группы'))).toBe(true)
    expect(result.lesson).toBeNull() // блок остался без единой группы -> отброшен -> блоков 0 -> фатально
  })

  it('#WORD внутри phrase_group — несовпадение типа блока', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK phrase_group | Фразы\n#WORD llamarse | зваться\nMe llamo. | Меня зовут.\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('#WORD'))).toBe(true)
  })

  it('#CATEGORY внутри verb_group — несовпадение типа блока', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\n#CATEGORY Общее\nMe llamo. | Меня зовут.\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('#CATEGORY'))).toBe(true)
  })

  it('ES: без RU: — ошибка при финализации блока', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK story | Рассказ\nES: Hola mundo.\n`
    const result = parser.parse(raw)
    expect(result.lesson).toBeNull()
    expect(result.errors.some((e) => e.message.includes('без соответствующей RU:'))).toBe(true)
  })

  it('RU: без предшествующей ES:', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK story | Рассказ\nRU: Привет мир.\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('без предшествующей ES:'))).toBe(true)
  })

  it('вторая пара ES:/RU: в одном story — ошибка, первая пара сохраняется', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK story | Рассказ\nES: Uno.\nRU: Один.\nES: Dos.\nRU: Два.\n`
    const result = parser.parse(raw)
    expect(result.lesson?.blocks[0].type).toBe('story')
    if (result.lesson?.blocks[0].type === 'story') {
      expect(result.lesson.blocks[0].textEs).toBe('Uno.')
    }
    expect(result.errors.some((e) => e.message.includes('только одну пару'))).toBe(true)
  })

  it('неизвестная директива, начинающаяся с #', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\n#FOO бла\nel gato | кот\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('Неизвестная директива'))).toBe(true)
    expect(result.stats.vocabCount).toBe(1)
  })

  it('пустой блок vocabulary отбрасывается с ошибкой, но другие блоки остаются', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK vocabulary | Пусто\n##BLOCK vocabulary | Слова\nel gato | кот\n`
    const result = parser.parse(raw)
    expect(result.lesson?.blocks).toHaveLength(1)
    expect(result.errors.some((e) => e.message.includes('не содержит слов'))).toBe(true)
    // Второй блок всё равно должен получить order_index 0 (первый не попал в итог)
    expect(result.lesson?.blocks[0].orderIndex).toBe(0)
  })

  it('дублирующийся #WORD В ПРЕДЕЛАХ ОДНОГО БЛОКА — ошибка валидации, но фразы всё равно объединяются (best-effort)', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\n#WORD tener | иметь\nTengo. | Имею.\n#WORD tener | иметь\nTienes. | Имеешь.\n`
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.message.includes('Дублирующийся ключ группы'))).toBe(true)
    expect(result.lesson?.blocks).toHaveLength(1)
    if (result.lesson?.blocks[0].type === 'verb_group') {
      expect(result.lesson.blocks[0].groups).toHaveLength(1)
      expect(result.lesson.blocks[0].groups[0].phrases).toHaveLength(2)
      expect(result.lesson.blocks[0].groups[0].phrases.map((p) => p.id)).toEqual(['01-b1-tener-01', '01-b1-tener-02'])
    }
  })

  it('тот же ключ группы в РАЗНЫХ блоках — валиден (id уникален за счёт block_id)', () => {
    const raw = `#TOPIC 1 | Тема\n##BLOCK verb_group | Блок А\n#WORD tener | иметь\nTengo. | Имею.\n##BLOCK verb_group | Блок Б\n#WORD tener | иметь\nTienes. | Имеешь.\n`
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    expect(result.lesson?.blocks).toHaveLength(2)
    if (result.lesson?.blocks[0].type === 'verb_group' && result.lesson.blocks[1].type === 'verb_group') {
      expect(result.lesson.blocks[0].groups[0].phrases[0].id).toBe('01-b1-tener-01')
      expect(result.lesson.blocks[1].groups[0].phrases[0].id).toBe('01-b2-tener-01')
    }
  })

  it('пустой файл — фатальная ошибка', () => {
    const result = parser.parse('')
    expect(result.lesson).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('РЕГРЕССИЯ: UTF-8 BOM (\\uFEFF) в начале файла срезается и не ломает #TOPIC/front-matter', () => {
    const withBomNoFrontMatter = '﻿#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nel gato | кот\n'
    const result = parser.parse(withBomNoFrontMatter)
    expect(result.errors).toEqual([])
    expect(result.lesson?.topicNumber).toBe(1)

    const withBomAndFrontMatter = '﻿---\ntopic_id: 01-bom-test\n---\n#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nel gato | кот\n'
    const result2 = parser.parse(withBomAndFrontMatter)
    expect(result2.errors).toEqual([])
    expect(result2.lesson?.topicId).toBe('01-bom-test')
  })
})

describe('ParserService — реальные уроки курса shared/course/*.txt', () => {
  // Точные счётчики согласованы с координатором задачи по фактическому контенту курса.
  const cases: Array<{ file: string; phraseCount: number; vocabCount: number; storyCount: number }> = [
    { file: 'topic-02.txt', phraseCount: 73, vocabCount: 0, storyCount: 0 },
    { file: 'topic-03.txt', phraseCount: 84, vocabCount: 14, storyCount: 1 },
    { file: 'topic-04.txt', phraseCount: 81, vocabCount: 14, storyCount: 1 }
  ]

  for (const c of cases) {
    it(`${c.file}: без ошибок, ${c.phraseCount} фраз / ${c.vocabCount} слов / ${c.storyCount} рассказ(ов)`, () => {
      const raw = readFileSync(resolve(COURSE_DIR, c.file), 'utf8')
      const result = parser.parse(raw)
      expect(result.errors).toEqual([])
      expect(result.lesson).not.toBeNull()
      expect(result.stats.phraseCount).toBe(c.phraseCount)
      expect(result.stats.vocabCount).toBe(c.vocabCount)
      expect(result.stats.storyCount).toBe(c.storyCount)
    })
  }

  it('vocabulary и story опциональны — topic-02.txt (только verb_group×3 + phrase_group) валиден без них', () => {
    const raw = readFileSync(resolve(COURSE_DIR, 'topic-02.txt'), 'utf8')
    const result = parser.parse(raw)
    expect(result.lesson?.blocks.map((b) => b.type)).toEqual(['verb_group', 'verb_group', 'verb_group', 'phrase_group'])
  })

  it('многословные и диакритические ключи #WORD слагифицируются корректно (topic-03/04)', () => {
    const raw = readFileSync(resolve(COURSE_DIR, 'topic-03.txt'), 'utf8')
    const { lesson } = parser.parse(raw)
    const allKeys = lesson!.blocks.flatMap((b) => (b.type === 'verb_group' || b.type === 'phrase_group' ? b.groups.map((g) => g.key) : []))
    expect(allKeys).toContain('hacer-match')
    expect(allKeys).toContain('sentarse')
    expect(allKeys).toContain('reirse') // reírse -> reirse (диакритика снята)

    const raw04 = readFileSync(resolve(COURSE_DIR, 'topic-04.txt'), 'utf8')
    const { lesson: lesson04 } = parser.parse(raw04)
    const keys04 = lesson04!.blocks.flatMap((b) => (b.type === 'verb_group' || b.type === 'phrase_group' ? b.groups.map((g) => g.key) : []))
    expect(keys04).toContain('dedicarse-a')
    expect(keys04).toContain('ganarse-la-vida')
    // Все id соответствуют паттерну схемы ^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$
    const idPattern = /^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$/
    for (const block of lesson04!.blocks) {
      if (block.type === 'verb_group' || block.type === 'phrase_group') {
        for (const g of block.groups) for (const p of g.phrases) expect(p.id).toMatch(idPattern)
      } else if (block.type === 'vocabulary') {
        for (const w of block.words) expect(w.id).toMatch(idPattern)
      }
    }
  })

  it('один и тот же ключ ("tener", "ser") в разных блоках topic-04.txt — валиден, без ошибок', () => {
    const raw = readFileSync(resolve(COURSE_DIR, 'topic-04.txt'), 'utf8')
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    const tenerBlocks = result.lesson!.blocks.filter(
      (b) => (b.type === 'verb_group' || b.type === 'phrase_group') && b.groups.some((g) => g.key === 'tener')
    )
    expect(tenerBlocks.length).toBeGreaterThanOrEqual(2)
  })

  it('русский текст со сложной пунктуацией (кавычки-ёлочки, тире, слэши) парсится как обычный текст', () => {
    const raw = readFileSync(resolve(COURSE_DIR, 'topic-04.txt'), 'utf8')
    const { lesson } = parser.parse(raw)
    const allPhrases = lesson!.blocks.flatMap((b) => {
      if (b.type === 'verb_group' || b.type === 'phrase_group') return b.groups.flatMap((g) => g.phrases)
      if (b.type === 'vocabulary') return b.words
      return []
    })
    const withDash = allPhrases.find((p) => p.ru.includes('а вечера — с семьёй'))
    expect(withDash).toBeDefined()
    expect(withDash?.es).toBe('Paso las mañanas trabajando y las tardes con mi familia.')
  })
})
