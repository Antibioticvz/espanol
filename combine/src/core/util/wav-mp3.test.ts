import { describe, expect, it } from 'vitest'
import { encodePcmToMp3, measureLoudness, normalizePcmRms, parseWav, pcmDurationMs } from './wav-mp3'

/** Чистый синус заданной пиковой амплитуды — RMS синуса = peak/√2 (удобно для конструирования тестовых уровней). */
function sineAtPeak(n: number, peak: number, freqHz = 440, sampleRate = 22050): Int16Array {
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((i / sampleRate) * freqHz * 2 * Math.PI) * peak)
  return out
}

function buildMinimalWavBuffer(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i] ?? 0, 44 + i * 2)
  }
  return buf
}

describe('parseWav', () => {
  it('парсит корректный mono 16-bit WAV', () => {
    const samples = new Int16Array([100, -100, 200, -200, 32000])
    const wav = buildMinimalWavBuffer(samples, 22050)
    const { samples: parsed, sampleRate } = parseWav(wav)
    expect(sampleRate).toBe(22050)
    expect(Array.from(parsed)).toEqual(Array.from(samples))
  })

  it('бросает понятную ошибку на не-WAV буфере', () => {
    expect(() => parseWav(Buffer.from('not a wav file at all'))).toThrow(/RIFF|WAVE/)
  })

  it('бросает понятную ошибку на stereo/не-16bit WAV', () => {
    const wav = buildMinimalWavBuffer(new Int16Array([1, 2]), 22050)
    wav.writeUInt16LE(2, 22) // подменяем channels на stereo
    expect(() => parseWav(wav)).toThrow(/mono 16-bit/)
  })

  it('РЕГРЕССИЯ: не бросает RangeError, когда byteOffset DATA-чанка внутри пулового/смещённого Buffer нечётный', () => {
    const samples = new Int16Array([1, -1, 12345, -12345, 0, 30000])
    const wav = buildMinimalWavBuffer(samples, 22050)

    // Принудительно создаём буфер, чей .byteOffset относительно СОБСТВЕННОГО ArrayBuffer равен 1
    // (нечётный) — allocUnsafeSlow гарантированно даёт отдельный ArrayBuffer с offset=0, поэтому
    // subarray(1) детерминированно даёт byteOffset=1. Внутри parseWav data-чанк начнётся на
    // смещении oddBuf.byteOffset + 44 = 45 (тоже нечётное) — именно это раньше бросало RangeError
    // из `new Int16Array(data.buffer, data.byteOffset, ...)`.
    const raw = Buffer.allocUnsafeSlow(wav.length + 1)
    raw.fill(0)
    wav.copy(raw, 1)
    const oddOffsetBuf = raw.subarray(1, 1 + wav.length)
    expect(oddOffsetBuf.byteOffset % 2).toBe(1) // подтверждаем, что тестовая установка действительно нечётная

    let result: ReturnType<typeof parseWav> | undefined
    expect(() => {
      result = parseWav(oddOffsetBuf)
    }).not.toThrow()
    expect(Array.from(result!.samples)).toEqual(Array.from(samples))
    expect(result!.sampleRate).toBe(22050)
  })
})

describe('normalizePcmRms (v1.2, D-23) — RMS-нормализация PCM для mock_say', () => {
  /** toBeCloseTo() второй аргумент — знаков после запятой, а не допуск в dB — явная проверка допуска понятнее. */
  function expectCloseTo(actual: number, expected: number, toleranceDb: number): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceDb)
  }

  it('громкий сигнал (RMS ~-4 dBFS) ослабляется к целевому -20 dBFS RMS, пик уходит вниз вместе с RMS', () => {
    // Синус на пике -1 dBFS: RMS синуса = peak/√2, т.е. примерно -4 dBFS.
    const peak = Math.round(32767 * Math.pow(10, -1 / 20))
    const loud = sineAtPeak(4000, peak)
    const before = measureLoudness(loud)
    expect(before.rmsDbfs).toBeGreaterThan(-6) // подтверждаем, что тестовая установка действительно "громкая"

    const result = normalizePcmRms(loud)
    const after = measureLoudness(result)

    expectCloseTo(after.rmsDbfs, -20, 1)
    expect(after.peakDbfs).toBeLessThanOrEqual(-1 + 0.5) // пик-лимит соблюдён (допуск на округление Int16)
    expect(after.peakDbfs).toBeLessThan(before.peakDbfs) // ослабление реально применено
  })

  it('тихий сигнал (RMS ~-40 dBFS) усиливается к целевому -20 dBFS RMS, не превышая пик-лимит', () => {
    // Синус на RMS ~-40 dBFS: peak = targetRms*√2.
    const targetRmsLinear = 32767 * Math.pow(10, -40 / 20)
    const peak = Math.round(targetRmsLinear * Math.SQRT2)
    const quiet = sineAtPeak(4000, peak)
    const before = measureLoudness(quiet)
    expectCloseTo(before.rmsDbfs, -40, 1)

    const result = normalizePcmRms(quiet)
    const after = measureLoudness(result)

    expectCloseTo(after.rmsDbfs, -20, 1) // цель достигнута точно — пик-лимит здесь не мешает
    expect(after.peakDbfs).toBeLessThanOrEqual(-1 + 0.5)
    expect(after.rmsDbfs).toBeGreaterThan(before.rmsDbfs) // усиление реально применено
  })

  it('пик-лимит побеждает целевой RMS: почти full-scale "щелчок" среди тихого фона НЕ усиливается до клиппинга', () => {
    // Один почти full-scale сэмпл (пик уже ВЫШЕ лимита -1 dBFS) + тихий детерминированный фон.
    // Наивная RMS-нормализация (RMS сигнала в целом ~-37 dBFS, ниже цели -20) захотела бы
    // усилить в ~7 раз — что раздуло бы уже-громкий пик далеко за клиппинг. Пик-лимит обязан победить.
    const n = 5000
    const samples = new Int16Array(n)
    samples[0] = 32000 // ~-0.2 dBFS — уже выше лимита -1 dBFS сам по себе
    for (let i = 1; i < n; i++) samples[i] = (i % 7) - 3 // тихий детерминированный "фон", RMS ~2

    const before = measureLoudness(samples)
    expect(before.peakDbfs).toBeGreaterThan(-1) // подтверждаем, что пик уже выше лимита ДО нормализации

    const result = normalizePcmRms(samples)
    const after = measureLoudness(result)

    // Гарантия "не клиппить" — самое важное свойство функции, важнее точного попадания в target.
    expect(after.peakDbfs).toBeLessThanOrEqual(-1 + 0.5)
    for (const s of result) {
      expect(s).toBeGreaterThanOrEqual(-32768)
      expect(s).toBeLessThanOrEqual(32767)
    }
    // Пик-лимит здесь означает ОСЛАБЛЕНИЕ (пик и так уже выше лимита), а не усиление до -20 dBFS RMS.
    expect(after.rmsDbfs).toBeLessThan(-20)
  })

  it('почти тишина (RMS ниже порога) НЕ усиливается — не "раздувается" фоновый шум', () => {
    // Детерминированный "почти-тишина" сигнал — RMS далеко ниже -50 dBFS порога по умолчанию.
    const n = 2000
    const quiet = new Int16Array(n)
    for (let i = 0; i < n; i++) quiet[i] = (i % 5) - 2 // значения в [-2, 2], RMS ~ единицы
    const before = measureLoudness(quiet)
    expect(before.rmsDbfs).toBeLessThan(-50)

    const result = normalizePcmRms(quiet)

    expect(result).toBe(quiet) // та же ссылка — функция явно не трогает почти-тишину
    expect(Array.from(result)).toEqual(Array.from(quiet))
  })

  it('полная цифровая тишина (все нули) — не бросает, возвращает как есть', () => {
    const silence = new Int16Array(500) // уже все нули
    const result = normalizePcmRms(silence)
    expect(result).toBe(silence)
    expect(measureLoudness(result).rmsDbfs).toBe(-Infinity)
  })

  it('уважает переопределённые targetDbfs/peakLimitDbfs/silenceRmsThresholdDbfs', () => {
    const peak = Math.round(32767 * Math.pow(10, -40 / 20) * Math.SQRT2)
    const quiet = sineAtPeak(4000, peak)
    const result = normalizePcmRms(quiet, { targetDbfs: -12, peakLimitDbfs: -3 })
    const after = measureLoudness(result)
    expectCloseTo(after.rmsDbfs, -12, 1)
    expect(after.peakDbfs).toBeLessThanOrEqual(-3 + 0.5)
  })
})

describe('encodePcmToMp3 / pcmDurationMs', () => {
  it('кодирует PCM в непустой валидный MP3 (реальный lamejs, без сети)', async () => {
    const sampleRate = 22050
    const durationSec = 0.2
    const n = Math.round(sampleRate * durationSec)
    const samples = new Int16Array(n)
    for (let i = 0; i < n; i++) samples[i] = Math.round(Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 10000)

    const mp3 = await encodePcmToMp3(samples, sampleRate, 64)
    expect(mp3.length).toBeGreaterThan(100)
    expect(mp3[0]).toBe(0xff)
    expect(mp3[1] & 0xe0).toBe(0xe0) // MP3 frame sync

    expect(pcmDurationMs(samples, sampleRate)).toBe(Math.round(durationSec * 1000))
  })
})
