/**
 * WAV (LEI16 mono) → MP3 через @breezystack/lamejs (чистый JS, без ffmpeg).
 * Логика 1:1 портирована из scripts/make-fixture.mjs (корень монорепо) — см. это как референс.
 * Динамический import(), т.к. lamejs — ESM-only пакет, а main-процесс Electron собирается в CJS
 * (electron-vite externalizeDepsPlugin оставил бы статический import как require(), что упало бы
 * с ERR_REQUIRE_ESM). Динамический import() работает из CJS в ESM в любом случае.
 */

export interface PcmData {
  samples: Int16Array
  sampleRate: number
}

export function parseWav(buf: Buffer): PcmData {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Не WAV-файл (отсутствуют заголовки RIFF/WAVE)')
  }
  let offset = 12
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null
  let data: Buffer | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      data = buf.subarray(body, body + size)
    }
    offset = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('WAV без чанков fmt/data')
  if (fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error(`Ожидался mono 16-bit WAV, получено ${fmt.channels}ch ${fmt.bits}bit`)
  }
  return {
    samples: new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2),
    sampleRate: fmt.sampleRate
  }
}

type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => {
  encodeBuffer(samples: Int16Array): Uint8Array
  flush(): Uint8Array
}

let cachedCtor: Mp3EncoderCtor | null = null

async function getMp3EncoderCtor(): Promise<Mp3EncoderCtor> {
  if (cachedCtor) return cachedCtor
  const mod: unknown = await import('@breezystack/lamejs')
  const anyMod = mod as { Mp3Encoder?: Mp3EncoderCtor; default?: { Mp3Encoder?: Mp3EncoderCtor } }
  const ctor = anyMod.Mp3Encoder ?? anyMod.default?.Mp3Encoder
  if (!ctor) throw new Error('Не удалось получить Mp3Encoder из @breezystack/lamejs')
  cachedCtor = ctor
  return ctor
}

export async function encodePcmToMp3(samples: Int16Array, sampleRate: number, kbps = 64): Promise<Buffer> {
  const Mp3Encoder = await getMp3EncoderCtor()
  const enc = new Mp3Encoder(1, sampleRate, kbps)
  const parts: Buffer[] = []
  const chunkSize = 1152
  for (let i = 0; i < samples.length; i += chunkSize) {
    const out = enc.encodeBuffer(samples.subarray(i, Math.min(i + chunkSize, samples.length)))
    if (out.length) parts.push(Buffer.from(out))
  }
  const tail = enc.flush()
  if (tail.length) parts.push(Buffer.from(tail))
  return Buffer.concat(parts)
}

export function pcmDurationMs(samples: Int16Array, sampleRate: number): number {
  return Math.round((samples.length / sampleRate) * 1000)
}
