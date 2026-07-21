import { describe, expect, it } from 'vitest'
import { encodePcmToMp3, parseWav, pcmDurationMs } from './wav-mp3'

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
