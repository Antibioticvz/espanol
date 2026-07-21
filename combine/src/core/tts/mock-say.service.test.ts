import { describe, expect, it } from 'vitest'
import { MockSayService } from './mock-say.service'

const SAY_OUTPUT_WITH_ES_RU = `
Alex                en_US    # Most people recognize me by my voice.
Mónica               es_ES    # Hola, me llamo Mónica y soy una voz española.
Milena               ru_RU    # Здравствуйте! Меня зовут Milena.
`

const SAY_OUTPUT_NO_ES_RU = `
Alex                en_US    # Most people recognize me by my voice.
Samantha             en_US    # Hello, my name is Samantha.
`

describe('MockSayService.resolveVoice — использует замокированный вывод say -v \'?\', без реального вызова', () => {
  it('резолвит Mónica/Milena из замокированного списка', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_WITH_ES_RU })
    const es = await service.resolveVoice('es')
    const ru = await service.resolveVoice('ru')
    expect(es).toEqual({ id: 'Mónica', name: 'Mónica', usedFallback: false })
    expect(ru).toEqual({ id: 'Milena', name: 'Milena', usedFallback: false })
  })

  it('graceful fallback + предупреждение, если голосов нужной локали нет', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_NO_ES_RU })
    const es = await service.resolveVoice('es')
    expect(es.usedFallback).toBe(true)
    expect(es.id).toBe('system-default')
    expect(es.warning).toBeDefined()
  })

  it('graceful fallback, если получение списка голосов вообще падает', async () => {
    const service = new MockSayService({
      listVoicesRaw: async () => {
        throw new Error('say: command not found')
      }
    })
    const es = await service.resolveVoice('es')
    expect(es.usedFallback).toBe(true)
  })

  it('кэширует резолв на весь сеанс (повторный вызов не переопрашивает список)', async () => {
    let calls = 0
    const service = new MockSayService({
      listVoicesRaw: async () => {
        calls += 1
        return SAY_OUTPUT_WITH_ES_RU
      }
    })
    await service.resolveVoice('es')
    await service.resolveVoice('es')
    await service.resolveVoice('ru')
    expect(calls).toBe(1)
  })

  it('listVoices() возвращает только голоса с локалью es_*/ru_*', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_WITH_ES_RU })
    const voices = await service.listVoices()
    expect(voices.map((v) => v.id).sort()).toEqual(['Milena', 'Mónica'])
  })

  it('listModels() возвращает единственную модель macos_say', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_WITH_ES_RU })
    const models = await service.listModels()
    expect(models).toEqual([{ id: 'macos_say', name: 'macOS say (mock, офлайн, бесплатно)' }])
  })
})

describe('MockSayService.synthesize — реальный вызов macOS say (бесплатно, локально, без сети)', () => {
  it('синтезирует слышимый MP3 для короткой ES-фразы', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_WITH_ES_RU })
    const result = await service.synthesize({
      text: 'Hola, ¿cómo estás?',
      lang: 'es',
      voiceId: 'Mónica',
      modelId: 'macos_say'
    })
    expect(Buffer.isBuffer(result.audio)).toBe(true)
    expect(result.audio.length).toBeGreaterThan(500)
    // MP3-фрейм начинается с sync-байтов 0xFF Ex (11 старших бит единиц)
    expect(result.audio[0]).toBe(0xff)
    expect(result.audio[1] & 0xe0).toBe(0xe0)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.characters).toBe('Hola, ¿cómo estás?'.length)
  })

  it('синтезирует и в fallback-режиме (без -v), если языковых голосов нет', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_NO_ES_RU })
    const result = await service.synthesize({
      text: 'Hola.',
      lang: 'es',
      voiceId: 'Mónica',
      modelId: 'macos_say'
    })
    expect(result.audio.length).toBeGreaterThan(200)
    expect(result.durationMs).toBeGreaterThan(0)
  })

  // v1.2 (D-23): интеграция с normalizePcmRms() — глубокое покрытие самой функции в
  // core/util/wav-mp3.test.ts (RMS до/после, пик-лимит, guard на тишину); здесь только
  // подтверждаем, что MockSayService реально уважает опцию (по умолчанию true — уже неявно
  // покрыто двумя тестами выше) и что normalize:false не ломает синтез.
  it('normalize:false отключает RMS-нормализацию, но синтез по-прежнему даёт валидный MP3', async () => {
    const service = new MockSayService({ listVoicesRaw: async () => SAY_OUTPUT_WITH_ES_RU, normalize: false })
    const result = await service.synthesize({
      text: 'Hola, ¿cómo estás?',
      lang: 'es',
      voiceId: 'Mónica',
      modelId: 'macos_say'
    })
    expect(result.audio[0]).toBe(0xff)
    expect(result.audio[1] & 0xe0).toBe(0xe0)
    expect(result.durationMs).toBeGreaterThan(0)
  })
})
