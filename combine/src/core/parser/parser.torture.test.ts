import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { ParserService } from './parser.service'
import { buildLessonSkeleton, type BuildSessionOptions } from '../queue/build-items'

/**
 * Torture-тесты ParserService: property-based фаззинг (детерминированный, seeded PRNG — без
 * новых зависимостей), направленные edge-cases и golden-счётчики на реальных фикстурах курса.
 *
 * ПРАВИЛА ЭТОГО ФАЙЛА (см. задачу тест-инженера):
 *  - только НОВЫЙ файл, ничего в parser.service.ts/build-items.ts не меняется;
 *  - если поведение парсера расходится с ожидаемым/желаемым — тест либо документирует ФАКТИЧЕСКОЕ
 *    поведение (проходит, "характеризующий" тест) и/или добавляет `it.skip` с репро ЖЕЛАЕМОГО
 *    поведения (сейчас закономерно упал бы) — такие тесты помечены «НАЙДЕН БАГ» и вынесены в отчёт.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKTREE_ROOT = resolve(__dirname, '../../../..')
const SCHEMA_PATH = resolve(WORKTREE_ROOT, 'shared/lesson.schema.json')

const parser = new ParserService()

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateLesson = ajv.compile(schema)

/** Опции сборки lesson.json-скелета, одинаковые для всех property-тестов (провайдер/голоса не важны для схемы). */
const FIXED_BUILD_OPTS: BuildSessionOptions = {
  provider: 'mock_say',
  model: 'macos_say',
  voices: {
    es: { id: 'Monica', name: 'Mónica' },
    ru: { id: 'Milena', name: 'Milena' }
  },
  stability: null,
  similarityBoost: null,
  seed: null
}

/* -------------------------------------------------------------------------------------------
 * Seeded PRNG (mulberry32) — детерминированный генератор псевдослучайных чисел в [0, 1).
 * Зашит прямо в тест (без новых npm-зависимостей вроде fast-check). Тот же seed => те же
 * документы => воспроизводимые падения в CI.
 * ------------------------------------------------------------------------------------------- */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return function (): number {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Выбирает `count` элементов из `pool` без повторов по ключу keyFn (best-effort — до 20×count попыток). */
function sampleUnique<T>(rng: () => number, pool: readonly T[], count: number, keyFn: (v: T) => string): T[] {
  const used = new Set<string>()
  const result: T[] = []
  let attempts = 0
  while (result.length < count && attempts < count * 20) {
    attempts++
    const candidate = pick(rng, pool)
    const key = keyFn(candidate)
    if (used.has(key)) continue
    used.add(key)
    result.push(candidate)
  }
  return result
}

/* =============================================================================================
 * ЧАСТЬ 1: свойство «не падает» — 250 случайных фрагментированных документов (валидные +
 * битые + смесь фрагментов). Инвариант из доккомента ParserService: best-effort, единственные
 * фатальные случаи — отсутствие #TOPIC и отсутствие валидных блоков (lesson=null), но ВСЕГДА
 * структурированный ParseResult, никогда необработанное исключение.
 * ============================================================================================= */

type FragmentFn = (rng: () => number) => string

const GARBAGE_CHARS = ['|', '#', ':', '\t', '   ', '​', ' ', '🎉', 'ñ', '漢', 'ة', '﻿', '-', '=', ' ']

function randomGarbageLine(rng: () => number): string {
  const len = randInt(rng, 0, 40)
  let s = ''
  for (let i = 0; i < len; i++) s += pick(rng, GARBAGE_CHARS)
  return s
}

// Пул фрагментов: валидные директивы формата + намеренно битые варианты + чистый мусор.
// Комбинируются в случайном порядке и количестве — цель не «валидный документ», а «парсер не
// должен упасть НИ НА ЧЁМ, что можно собрать из этих кусочков».
const FUZZ_FRAGMENTS: FragmentFn[] = [
  (rng) => `#TOPIC ${randInt(rng, 1, 99)} | Тема ${randInt(rng, 1, 999)}`,
  () => `#TOPIC | без номера`,
  () => `#TOPIC abc | нечисло`,
  () => `#TOPIC -5 | отрицательная`,
  () => `#TOPIC 4.5 | дробная`,
  () => `#TOPIC`,
  (rng) => `##BLOCK vocabulary | Слова ${randInt(rng, 1, 99)}`,
  () => `##BLOCK verb_group | Глаголы`,
  () => `##BLOCK phrase_group | Фразы`,
  () => `##BLOCK story | Рассказ`,
  () => `##BLOCK weird_type | Странный`,
  () => `##BLOCK`,
  () => `#WORD tener | иметь`,
  () => `#WORD | без слова`,
  () => `#WORD`,
  () => `#CATEGORY Общее`,
  () => `#CATEGORY`,
  () => `el gato | кот`,
  () => `texto sin separador`,
  () => `| media vacia`,
  () => `media vacia |`,
  () => `ES | RU | extra`,
  () => `ES: Hola mundo`,
  () => `RU: Привет мир`,
  () => `#FOO бла бла`,
  () => ``,
  () => `   `,
  () => `\t\t`,
  (rng) => randomGarbageLine(rng),
  (rng) => 'a'.repeat(randInt(rng, 100, 3000)) + ' | ' + 'b'.repeat(randInt(rng, 100, 3000)),
  () => `---`,
  () => `topic_id: not valid !!!`,
  () => `¿Cómo estás? 😊 | Как дела? 🎉`
]

function genFuzzDoc(seed: number): string {
  const rng = mulberry32(seed)
  const lineCount = randInt(rng, 3, 40)
  const lines: string[] = []
  // Изредка склеиваем BOM с первым фрагментом (BOM осмыслен только на самом первом символе файла).
  if (rng() < 0.05) lines.push('﻿' + pick(rng, FUZZ_FRAGMENTS)(rng))
  for (let i = 0; i < lineCount; i++) {
    lines.push(pick(rng, FUZZ_FRAGMENTS)(rng))
  }
  let doc = lines.join(rng() < 0.5 ? '\n' : '\r\n')
  if (rng() < 0.05) doc = '﻿' + doc
  return doc
}

describe('ParserService — property: «не падает» (250 случайных фрагментированных документов)', () => {
  const N = 250
  for (let seed = 1; seed <= N; seed++) {
    it(`seed=${seed}: parse() не бросает и возвращает структурированный ParseResult`, () => {
      const doc = genFuzzDoc(seed * 7919 + 13)
      const run = (): ReturnType<typeof parser.parse> => parser.parse(doc)

      expect(run).not.toThrow()
      const result = run() // parse() — чистая функция (см. докстринг ParserService), повторный вызов безопасен

      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)

      // Инвариант: «либо результат, либо структурированные ошибки с номерами строк» —
      // lesson=null обязан сопровождаться хотя бы одной ошибкой (иначе непонятно, ПОЧЕМУ урока нет).
      if (result.lesson === null) {
        expect(result.errors.length).toBeGreaterThan(0)
      } else {
        expect(result.lesson.blocks.length).toBeGreaterThan(0)
      }

      // Каждая ошибка/предупреждение — структурировано: message непустая строка, line число или null.
      for (const issue of [...result.errors, ...result.warnings]) {
        expect(typeof issue.message).toBe('string')
        expect(issue.message.length).toBeGreaterThan(0)
        expect(issue.line === null || typeof issue.line === 'number').toBe(true)
      }
    })
  }
})

/* =============================================================================================
 * ЧАСТЬ 2: roundtrip-свойство — 200 случайных ВАЛИДНЫХ документов (случайные блоки/группы/фразы
 * с диакритикой, многословными ключами, unicode). parse -> должен дать 0 ошибок -> сборка
 * lesson.json-скелета -> ajv-валидация против shared/lesson.schema.json должна проходить.
 *
 * Границы генератора нарочно держат topicNumber в [1,99] и размеры групп небольшими —
 * иначе тест уткнулся бы в БАГ переполнения 2-значного id (см. отдельные направленные тесты
 * «группа из 100+ фраз» и «тема с номером 100» ниже, где это поведение исследуется целенаправленно).
 * ============================================================================================= */

const RU_TITLES = ['Разговор о путешествиях', 'Мой обычный день', 'Ñандý в зоопарке', 'Электронная почта 📧', 'Знакомство с новыми людьми', 'Ещё один день'] as const
const VERBS = [
  'llamarse',
  'tener',
  'ser',
  'hacer match',
  'reírse',
  'dedicarse a',
  'ganarse la vida',
  'sentarse',
  'jugar al fútbol',
  'soñar',
  'acostumbrarse a',
  'darse cuenta'
] as const
const CATEGORIES = ['Первое знакомство', 'О работе', 'Скидки и цены 💰', 'Ещё вопросы', 'Электронная почта', 'Мороженое и десерты'] as const
const ES_SENTENCES = [
  '¿Cómo estás hoy?',
  'Muy bien, gracias por preguntar.',
  'Mañana volveré temprano.',
  'El corazón late muy rápido.',
  'Ñoño y pequeño, así es él.',
  '¡Qué alegría verte de nuevo! 😊',
  'Después de comer, dormimos la siesta.',
  'Ácido, útil, íntimo — palabras con tilde.',
  'Ella se ríe mucho últimamente.',
  'Ünïcode también aparece aquí 🎉🌍'
] as const
const RU_SENTENCES = [
  'Как у тебя дела сегодня?',
  'Очень хорошо, спасибо, что спросил.',
  'Завтра я вернусь рано.',
  'Сердце бьётся очень быстро.',
  'Простой и маленький, вот такой он.',
  'Как приятно увидеть тебя снова! 😊',
  'После еды мы спим сиесту.',
  'Слова с ударением: острый, полезный.',
  'Она много смеётся в последнее время.',
  'Юникод тоже здесь встречается 🎉🌍'
] as const

function randPhrase(rng: () => number): { es: string; ru: string } {
  return { es: pick(rng, ES_SENTENCES), ru: pick(rng, RU_SENTENCES) }
}

function genValidDoc(seed: number): string {
  const rng = mulberry32(seed)
  const topicNumber = randInt(rng, 1, 99)
  const topicTitleRu = pick(rng, RU_TITLES)
  const blockCount = randInt(rng, 1, 4)
  const blockTypes = ['verb_group', 'phrase_group', 'vocabulary', 'story'] as const
  const lines: string[] = [`#TOPIC ${topicNumber} | ${topicTitleRu}`, '']
  for (let b = 0; b < blockCount; b++) {
    const type = pick(rng, blockTypes)
    lines.push(`##BLOCK ${type} | Блок ${b + 1} (${type})`)
    if (type === 'verb_group') {
      const verbs = sampleUnique(rng, VERBS, randInt(rng, 1, 4), (v) => v)
      for (const verb of verbs) {
        lines.push(`#WORD ${verb} | перевод глагола`)
        const n = randInt(rng, 1, 5)
        for (let i = 0; i < n; i++) {
          const p = randPhrase(rng)
          lines.push(`${p.es} | ${p.ru}`)
        }
      }
    } else if (type === 'phrase_group') {
      const cats = sampleUnique(rng, CATEGORIES, randInt(rng, 1, 4), (c) => c)
      for (const cat of cats) {
        lines.push(`#CATEGORY ${cat}`)
        const n = randInt(rng, 1, 5)
        for (let i = 0; i < n; i++) {
          const p = randPhrase(rng)
          lines.push(`${p.es} | ${p.ru}`)
        }
      }
    } else if (type === 'vocabulary') {
      const n = randInt(rng, 1, 10)
      for (let i = 0; i < n; i++) {
        const p = randPhrase(rng)
        lines.push(`${p.es} | ${p.ru}`)
      }
    } else {
      const p = randPhrase(rng)
      lines.push(`ES: ${p.es}`)
      lines.push(`RU: ${p.ru}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

describe('ParserService — property: roundtrip (200 случайных валидных документов) parse -> lesson.json -> ajv', () => {
  const N = 200
  for (let seed = 1; seed <= N; seed++) {
    it(`seed=${seed}: валидный документ парсится без ошибок и проходит ajv-валидацию shared/lesson.schema.json`, () => {
      const doc = genValidDoc(seed * 104729 + 3)
      const result = parser.parse(doc)

      expect(result.errors).toEqual([])
      expect(result.lesson).not.toBeNull()

      const skeleton = buildLessonSkeleton(result.lesson!, FIXED_BUILD_OPTS, result.stats)
      const valid = validateLesson(skeleton)
      if (!valid) {
        // eslint-disable-next-line no-console
        console.error(`[roundtrip seed=${seed}] ajv errors:`, validateLesson.errors)
      }
      expect(valid).toBe(true)
    })
  }
})

/* =============================================================================================
 * ЧАСТЬ 3: направленные edge-cases (по одному тесту на случай из задачи).
 * ============================================================================================= */

describe('ParserService — направленные edge-cases', () => {
  it('BOM (U+FEFF) в начале файла + CRLF-переводы строк одновременно — парсится корректно', () => {
    const raw = '﻿#TOPIC 1 | Тема\r\n##BLOCK vocabulary | Лексика\r\nel gato | кот\r\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    expect(result.lesson?.topicNumber).toBe(1)
    expect(result.stats.vocabCount).toBe(1)
  })

  it('CRLF-переводы строк по всему многоблочному документу — те же счётчики, что и эквивалент с LF', () => {
    const lf = `#TOPIC 7 | Тема CRLF\n##BLOCK vocabulary | Слова\nel gato | кот\nel perro | собака\n##BLOCK story | Рассказ\nES: Hola.\nRU: Привет.\n`
    const crlf = lf.replace(/\n/g, '\r\n')
    const resultLf = parser.parse(lf)
    const resultCrlf = parser.parse(crlf)
    expect(resultCrlf.errors).toEqual([])
    expect(resultCrlf.stats).toEqual(resultLf.stats)
    expect(resultCrlf.lesson?.topicId).toBe(resultLf.lesson?.topicId)
  })

  describe('лишний "|" внутри строки фразы ("ES | RU | лишнее")', () => {
    it('ФИКС: лишний "|" — структурированная ошибка на своей строке, фраза не создаётся, соседние строки живут', () => {
      const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nHola | Mundo | Extra\nel sol | солнце\n'
      const result = parser.parse(raw)
      expect(result.errors.some((e) => e.line === 3 && /раздел/i.test(e.message))).toBe(true)
      if (result.lesson?.blocks[0].type === 'vocabulary') {
        expect(result.lesson.blocks[0].words).toHaveLength(1)
        expect(result.lesson.blocks[0].words[0].es).toBe('el sol')
      } else {
        throw new Error('ожидался блок vocabulary')
      }
    })

    // НАЙДЕН БАГ (см. отчёт): задача формулирует ожидание «ошибка с номером строки, не тихая
    // порча» для строки вида "ES | RU | лишнее". Текущий парсер (parser.service.ts, ветка обычной
    // фразы "ES | RU", near строка ~394) такой проверки не делает — лишний "|" неотличим от
    // литерального "|" внутри легитимного RU-текста. Автору: либо явная ошибка при >1 "|" на
    // строке фразы, либо осознанно документировать нынешнее поведение (тогда снять skip).
    it('БАГ-репро: "ES | RU | лишнее" ДОЛЖНО давать структурированную ошибку с номером строки, а не тихо склеивать RU="Mundo | Extra"', () => {
      const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nHola | Mundo | Extra\n'
      const result = parser.parse(raw)
      expect(result.errors.length).toBeGreaterThan(0) // сейчас 0
      expect(result.errors.some((e) => e.line === 3)).toBe(true)
    })
  })

  it('пустая ES-половина "| текст" — ошибка с номером строки (не создаёт фиктивную фразу)', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\n| текст\n'
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('Пустая часть фразы'))).toBe(true)
  })

  it('пустая RU-половина "текст |" — ошибка с номером строки', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\ntexto |\n'
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.line === 3 && e.message.includes('Пустая часть фразы'))).toBe(true)
  })

  it('#WORD без единой фразы после него — группа отбрасывается предупреждением (не ошибкой), блок выживает за счёт другой группы', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\n#WORD vacio | пусто\n#WORD tener | иметь\nTengo. | Имею.\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.message.includes('«vacio»') && w.message.includes('не содержит фраз'))).toBe(true)
    if (result.lesson?.blocks[0].type === 'verb_group') {
      expect(result.lesson.blocks[0].groups.map((g) => g.key)).toEqual(['tener'])
    } else {
      throw new Error('ожидался блок verb_group')
    }
  })

  it('##BLOCK verb_group совсем без #WORD (нет ни одной группы) — блок отбрасывается ошибкой, следующий блок остаётся', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\n##BLOCK vocabulary | Слова\nel gato | кот\n'
    const result = parser.parse(raw)
    expect(result.errors.some((e) => e.message.includes('не содержит ни одной группы с фразами'))).toBe(true)
    expect(result.lesson?.blocks).toHaveLength(1)
    expect(result.lesson?.blocks[0].type).toBe('vocabulary')
  })

  it('два #TOPIC подряд — второй игнорируется с ошибкой на своей строке, побеждает первый', () => {
    const raw = '#TOPIC 1 | Первая\n#TOPIC 2 | Вторая\n##BLOCK vocabulary | Лексика\nel gato | кот\n'
    const result = parser.parse(raw)
    expect(result.lesson?.topicNumber).toBe(1)
    expect(result.errors.some((e) => e.line === 2 && e.message.includes('Повторный #TOPIC'))).toBe(true)
  })

  it('ключ группы из одной диакритики "ñ" (#CATEGORY Ñ) — слагифицируется в непустой ключ "n", без коллизий/фолбэка на "x"', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK phrase_group | Фразы\n#CATEGORY Ñ\nHola. | Привет.\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    if (result.lesson?.blocks[0].type === 'phrase_group') {
      expect(result.lesson.blocks[0].groups[0].key).toBe('n')
      expect(result.lesson.blocks[0].groups[0].titleRu).toBe('Ñ')
    } else {
      throw new Error('ожидался блок phrase_group')
    }
  })

  it('ключ группы из #WORD "ñ" — та же слагификация, итоговый id проходит паттерн схемы', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK verb_group | Глаголы\n#WORD ñ | буква\nHabla. | Говорит.\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    if (result.lesson?.blocks[0].type === 'verb_group') {
      expect(result.lesson.blocks[0].groups[0].key).toBe('n')
      expect(result.lesson.blocks[0].groups[0].phrases[0].id).toMatch(/^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$/)
    } else {
      throw new Error('ожидался блок verb_group')
    }
  })

  it('очень длинная строка фразы (10 000 символов) — не падает, длина сохраняется точно', () => {
    const longEs = 'a'.repeat(10000)
    const raw = `#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\n${longEs} | corto\n`
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    if (result.lesson?.blocks[0].type === 'vocabulary') {
      expect(result.lesson.blocks[0].words[0].es).toHaveLength(10000)
    } else {
      throw new Error('ожидался блок vocabulary')
    }
    expect(result.stats.charactersEs).toBeGreaterThanOrEqual(10000)
  })

  it('эмодзи в тексте фразы — не падает; JS .length считает UTF-16 code units (эмодзи вне BMP = 2 юнита на символ)', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nHola 👋🌍 | Привет 👋🌍\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    if (result.lesson?.blocks[0].type === 'vocabulary') {
      const word = result.lesson.blocks[0].words[0]
      expect(word.es).toBe('Hola 👋🌍')
      expect(word.es).toHaveLength(9) // "Hola " (5) + 👋 (2 code units) + 🌍 (2 code units)
      expect([...word.es]).toHaveLength(7) // по code points — честные 7 «символов»
    } else {
      throw new Error('ожидался блок vocabulary')
    }
  })

  it('смешанные табы и пробелы вокруг "|" — обе половины триммятся корректно', () => {
    const raw = '#TOPIC 1 | Тема\n##BLOCK vocabulary | Лексика\nHola\t|\t Mundo \t\n'
    const result = parser.parse(raw)
    expect(result.errors).toEqual([])
    if (result.lesson?.blocks[0].type === 'vocabulary') {
      expect(result.lesson.blocks[0].words[0]).toMatchObject({ es: 'Hola', ru: 'Mundo' })
    } else {
      throw new Error('ожидался блок vocabulary')
    }
  })
})

/* =============================================================================================
 * ЧАСТЬ 4: группа/vocabulary-блок со 100+ фразами — переполнение 2-значного номера в id.
 * pad2() в src/core/util/slug.ts — String(n).padStart(2,'0') — ДОПОЛНЯЕТ до 2 знаков, но НЕ
 * ОГРАНИЧИВАЕТ: при n>=100 результат — 3+ цифры, что ломает id-паттерн схемы
 * "^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$" (ровно 2 цифры в конце).
 * ============================================================================================= */

describe('ParserService — edge-case: группа/vocabulary-блок с 100+ фразами (переполнение id)', () => {
  function buildDocWithNWords(n: number): string {
    const lines = ['#TOPIC 5 | Много слов', '##BLOCK vocabulary | Слова']
    for (let i = 0; i < n; i++) lines.push(`palabra${i} | слово${i}`)
    return lines.join('\n')
  }

  const ID_PATTERN = /^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$/

  it('ФИКС: элементы после 99-го отклоняются ошибками с номерами строк, первые 99 сохраняются', () => {
    const result = parser.parse(buildDocWithNWords(105))
    expect(result.errors).toHaveLength(6)
    expect(result.errors.every((e) => /99/.test(e.message))).toBe(true)
    expect(result.errors.map((e) => e.line ?? 0).sort((a, b) => a - b)).toEqual([102, 103, 104, 105, 106, 107])
    if (result.lesson?.blocks[0].type === 'vocabulary') {
      const words = result.lesson.blocks[0].words
      expect(words).toHaveLength(99)
      expect(words[98].id).toBe('05-b1-vocab-99')
    } else {
      throw new Error('ожидался блок vocabulary')
    }
  })

  it('ФИКС: все сохранённые id соответствуют id-паттерну схемы', () => {
    const result = parser.parse(buildDocWithNWords(105))
    if (result.lesson?.blocks[0].type !== 'vocabulary') throw new Error('ожидался блок vocabulary')
    expect(result.lesson.blocks[0].words.every((w) => ID_PATTERN.test(w.id))).toBe(true)
  })

  // НАЙДЕН БАГ (см. отчёт, приоритет средний — реалистичные уроки едва ли достигают 100 фраз в
  // одной группе, но ничто в парсере это не предотвращает и не предупреждает, а сгенерированный
  // lesson.json тихо перестаёт быть валидным по контракту). Варианты для автора: (а) расширить
  // паттерн схемы с {2} на {2,}, (б) явно ограничить парсер 99 элементами в группе структурной
  // ParseIssue-ошибкой, (в) увеличить ширину паджинга индекса. См. также контрактный вектор
  // invalid-id-no-trailing-number.json в shared/contract-tests — тот же класс паттерна с другой стороны.
  it('БАГ-репро: lesson.json для vocabulary-блока со 105 словами ДОЛЖЕН быть валиден по схеме (или парсер должен явно отклонять группы с 100+ элементами)', () => {
    const result = parser.parse(buildDocWithNWords(105))
    const skeleton = buildLessonSkeleton(result.lesson!, FIXED_BUILD_OPTS, result.stats)
    expect(validateLesson(skeleton)).toBe(true) // сейчас false
  })
})

/* =============================================================================================
 * ЧАСТЬ 5: тема с номером 100 — переполнение 2-значного номера ТЕМЫ. Более серьёзный вариант той
 * же корневой причины: ломается topic_id И id КАЖДОЙ фразы/слова во всём уроке, а не только
 * «лишние» элементы одной группы.
 * ============================================================================================= */

describe('ParserService — edge-case: тема с номером 100 (переполнение 2-значного topic-номера)', () => {
  const DOC_TOPIC_100 = '#TOPIC 100 | Сотая тема\n##BLOCK vocabulary | Лексика\nel gato | кот\n'

  it('ФИКС: #TOPIC 100 отклоняется ошибкой на строке 1, урок не строится', () => {
    const result = parser.parse(DOC_TOPIC_100)
    expect(result.errors.some((e) => e.line === 1 && /от 1 до 99/.test(e.message))).toBe(true)
    expect(result.lesson).toBeNull()
  })

  // НАЙДЕН БАГ (см. отчёт, приоритет ВЫШЕ, чем «группа >99» — здесь ломается topic_id, то есть
  // КАЖДЫЙ id во всём уроке, уже с первой фразы). #TOPIC не имеет верхней границы в парсере
  // (parser.service.ts проверяет только num<1), а pad2()/slugify() из src/core/util/slug.ts не
  // обрезают и не расширяют паджинг — при topicNumber>=100 результат pad2 — 3+ цифры, что ломает
  // и topic_id ("^[0-9]{2}-[a-z0-9-]+$"), и id каждой фразы/слова
  // ("^[0-9]{2}-(b[0-9]+-)?[a-z0-9-]+-[0-9]{2}$"). Замечание: FileService.assertSafeTopicId
  // (src/core/file/file.service.ts) использует тот же паттерн topic_id и бросит
  // «Небезопасный или некорректный topic_id» при попытке сохранить такой урок на диск — то есть
  // ошибка ВСЁ РАВНО всплывёт при generate/write, но не на этапе parse (со строкой #TOPIC), а
  // значительно позже и куда менее понятно для автора урока. Стоит валидировать topicNumber<=99
  // прямо в ParserService структурированной ParseIssue на строке #TOPIC.
  it('ФИКС-подтверждение: parse() ограничивает #TOPIC значением <=99 структурированной ошибкой на строке #TOPIC', () => {
    const result = parser.parse(DOC_TOPIC_100)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].line).toBe(1)
    expect(result.lesson).toBeNull()
  })
})

/* =============================================================================================
 * ЧАСТЬ 6: golden-тесты — точные счётчики на реальных фикстурах курса и sample-lessons.
 * ============================================================================================= */

describe('ParserService — golden-тесты: точные счётчики на всех фикстурах курса/sample-lessons', () => {
  const cases: Array<{ path: string; phraseCount: number; vocabCount: number; storyCount: number; blockCount: number }> = [
    { path: 'shared/course/topic-02.txt', phraseCount: 73, vocabCount: 0, storyCount: 0, blockCount: 4 },
    { path: 'shared/course/topic-03.txt', phraseCount: 84, vocabCount: 14, storyCount: 1, blockCount: 6 },
    { path: 'shared/course/topic-04.txt', phraseCount: 81, vocabCount: 14, storyCount: 1, blockCount: 6 },
    // shared/sample-lessons/topic-90 и topic-91: точные числа не были заданы в задаче — посчитаны
    // фактическим запуском парсера (см. отчёт) и зафиксированы здесь как golden-значения.
    { path: 'shared/sample-lessons/topic-90.txt', phraseCount: 21, vocabCount: 15, storyCount: 1, blockCount: 4 },
    { path: 'shared/sample-lessons/topic-91.txt', phraseCount: 23, vocabCount: 13, storyCount: 1, blockCount: 4 },
    { path: 'shared/sample-lessons/topic-04.txt', phraseCount: 9, vocabCount: 4, storyCount: 1, blockCount: 4 }
  ]

  for (const c of cases) {
    it(`${c.path}: ${c.phraseCount} фраз / ${c.vocabCount} слов / ${c.storyCount} рассказ(ов) / ${c.blockCount} блок(ов), без ошибок`, () => {
      const raw = readFileSync(resolve(WORKTREE_ROOT, c.path), 'utf8')
      const result = parser.parse(raw)
      expect(result.errors).toEqual([])
      expect(result.lesson).not.toBeNull()
      expect(result.stats.phraseCount).toBe(c.phraseCount)
      expect(result.stats.vocabCount).toBe(c.vocabCount)
      expect(result.stats.storyCount).toBe(c.storyCount)
      expect(result.stats.blockCount).toBe(c.blockCount)
    })
  }

  it('каждая фикстура также проходит полный roundtrip (parse -> lesson.json -> ajv)', () => {
    for (const c of cases) {
      const raw = readFileSync(resolve(WORKTREE_ROOT, c.path), 'utf8')
      const result = parser.parse(raw)
      const skeleton = buildLessonSkeleton(result.lesson!, FIXED_BUILD_OPTS, result.stats)
      const valid = validateLesson(skeleton)
      if (!valid) {
        // eslint-disable-next-line no-console
        console.error(`[golden roundtrip ${c.path}] ajv errors:`, validateLesson.errors)
      }
      expect(valid).toBe(true)
    }
  })
})
