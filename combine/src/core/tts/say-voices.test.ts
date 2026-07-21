import { describe, expect, it } from 'vitest'
import { parseSayVoiceList, pickVoiceForLang } from './say-voices'

// Замокированный (не реальный вызов) вывод `say -v '?'` — с ES/RU голосами.
const SAY_OUTPUT_WITH_ES_RU = `
Alex                en_US    # Most people recognize me by my voice.
Diego               es_AR    # Hola, me llamo Diego y soy una voz argentina.
Jorge                es_ES    # Hola, me llamo Jorge y soy una voz española.
Mónica               es_ES    # Hola, me llamo Mónica y soy una voz española.
Paulina              es_MX    # Hola, me llamo Paulina y soy una voz mexicana.
Milena               ru_RU    # Здравствуйте! Меня зовут Milena.
Yuri                  ru_RU    # Здравствуйте! Меня зовут Юрий.
Samantha             en_US    # Hello, my name is Samantha.
`

// Вывод БЕЗ каких-либо es_*/ru_* голосов — эмулирует "чужую машину"/CI без языковых пакетов.
const SAY_OUTPUT_NO_ES_RU = `
Alex                en_US    # Most people recognize me by my voice.
Samantha             en_US    # Hello, my name is Samantha.
Karen                en_AU    # Hello, my name is Karen. I am an Australian-English voice.
`

describe('parseSayVoiceList', () => {
  it('разбирает строки формата "Имя  locale  # sample"', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    expect(voices).toHaveLength(8)
    expect(voices[0]).toEqual({ name: 'Alex', locale: 'en_US', sample: 'Most people recognize me by my voice.' })
    const monica = voices.find((v) => v.name === 'Mónica')
    expect(monica).toEqual({ name: 'Mónica', locale: 'es_ES', sample: 'Hola, me llamo Mónica y soy una voz española.' })
  })

  it('игнорирует пустые строки и не падает на пустом выводе', () => {
    expect(parseSayVoiceList('')).toEqual([])
    expect(parseSayVoiceList('\n\n   \n')).toEqual([])
  })

  it('поддерживает имена голосов с пробелами (напр. "Bad News")', () => {
    const voices = parseSayVoiceList('Bad News            en_US    # Test.\n')
    expect(voices).toEqual([{ name: 'Bad News', locale: 'en_US', sample: 'Test.' }])
  })
})

describe('pickVoiceForLang — graceful fallback (координатор: голоса могут быть не установлены)', () => {
  it('выбирает Mónica для es, если она установлена и предпочтений нет', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    const resolved = pickVoiceForLang(voices, 'es')
    expect(resolved).toEqual({ id: 'Mónica', name: 'Mónica', usedFallback: false })
  })

  it('выбирает Milena для ru, если она установлена', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    const resolved = pickVoiceForLang(voices, 'ru')
    expect(resolved).toEqual({ id: 'Milena', name: 'Milena', usedFallback: false })
  })

  it('уважает явный preferredId, если он установлен и локаль совпадает', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    const resolved = pickVoiceForLang(voices, 'es', 'Paulina')
    expect(resolved).toEqual({ id: 'Paulina', name: 'Paulina', usedFallback: false })
  })

  it('игнорирует preferredId, если голос с таким именем не найден, и берёт первый по локали', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    const resolved = pickVoiceForLang(voices, 'es', 'НетТакогоГолоса')
    expect(resolved.usedFallback).toBe(false)
    expect(resolved.id).toBe('Mónica') // Mónica предпочтительна среди совпадающих по локали
  })

  it('игнорирует preferredId, если голос с таким именем есть, но локаль не подходит', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_WITH_ES_RU)
    // "Samantha" установлена, но это en_US — не годится для ru
    const resolved = pickVoiceForLang(voices, 'ru', 'Samantha')
    expect(resolved.id).toBe('Milena')
  })

  it('graceful fallback на системный голос по умолчанию, если ни одного es_*/ru_* голоса нет', () => {
    const voices = parseSayVoiceList(SAY_OUTPUT_NO_ES_RU)
    const resolvedEs = pickVoiceForLang(voices, 'es')
    expect(resolvedEs.usedFallback).toBe(true)
    expect(resolvedEs.id).toBe('system-default')
    expect(resolvedEs.warning).toContain('es_*')

    const resolvedRu = pickVoiceForLang(voices, 'ru')
    expect(resolvedRu.usedFallback).toBe(true)
    expect(resolvedRu.warning).toContain('ru_*')
  })

  it('при отсутствии предпочтительного голоса берёт первый подходящий по локали, даже если это не Mónica/Milena', () => {
    const voices = parseSayVoiceList('Diego es_AR # sample\nJorge es_ES # sample\n')
    const resolved = pickVoiceForLang(voices, 'es')
    expect(resolved.id).toBe('Diego')
    expect(resolved.usedFallback).toBe(false)
  })
})
