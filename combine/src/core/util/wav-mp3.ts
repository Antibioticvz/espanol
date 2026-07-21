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
    samples: toAlignedInt16Array(data),
    sampleRate: fmt.sampleRate
  }
}

/**
 * `data` — это `buf.subarray(...)`, т.е. вид поверх общего ArrayBuffer буфера `buf`, чей
 * byteOffset — сумма позиции DATA-чанка в WAV-файле (значение, зависящее от размеров
 * предшествующих чанков, произвольное) и возможного смещения самого `buf` в пуле Node.js
 * (Buffer.allocUnsafe для небольших буферов нарезает из общего пула по произвольной границе).
 * Int16Array ТРЕБУЕТ byteOffset, кратный 2 (BYTES_PER_ELEMENT) — иначе бросает RangeError.
 * Копируем в свежий невыровненный-с-пулом буфер (allocUnsafeSlow гарантированно даёт
 * собственный ArrayBuffer с byteOffset=0) только когда это реально необходимо.
 */
function toAlignedInt16Array(data: Buffer): Int16Array {
  if (data.byteOffset % 2 === 0) {
    return new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2)
  }
  const aligned = Buffer.allocUnsafeSlow(data.byteLength)
  data.copy(aligned)
  return new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2)
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

// ---------------------------------------------------------------------------
// Нормализация громкости (v1.2, D-23) — RMS-нормализация для mock_say (см. docs/DECISIONS.md).
// ElevenLabs отдаёт готовый MP3 (не PCM) и нормализуется отдельно, через внешний ffmpeg
// (core/util/ffmpeg.ts) — здесь только PCM-путь, для которого не нужен никакой внешний бинарник.
// ---------------------------------------------------------------------------

export interface NormalizePcmOptions {
  /** Целевой уровень RMS в dBFS. По умолчанию -20 (типичный "разговорный" таргет для TTS-контента). */
  targetDbfs?: number
  /** Пик НИКОГДА не должен превысить этот уровень (защита от клиппинга) — важнее targetDbfs. */
  peakLimitDbfs?: number
  /** RMS тише этого порога (dBFS) считается "почти тишиной" и не усиливается — см. докстринг ниже. */
  silenceRmsThresholdDbfs?: number
}

const DEFAULT_TARGET_DBFS = -20
const DEFAULT_PEAK_LIMIT_DBFS = -1
const DEFAULT_SILENCE_RMS_THRESHOLD_DBFS = -50
const INT16_FULL_SCALE = 32767

function dbfsToLinear(dbfs: number): number {
  return Math.pow(10, dbfs / 20) * INT16_FULL_SCALE
}

function linearToDbfs(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear / INT16_FULL_SCALE)
}

function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i]
  return Math.sqrt(sumSquares / samples.length)
}

function computePeakAbs(samples: Int16Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }
  return peak
}

/** Только для тестов/диагностики — что нормализация "видит" в сигнале, без его изменения. */
export function measureLoudness(samples: Int16Array): { rmsDbfs: number; peakDbfs: number } {
  return { rmsDbfs: linearToDbfs(computeRms(samples)), peakDbfs: linearToDbfs(computePeakAbs(samples)) }
}

/**
 * RMS-нормализация 16-bit PCM к целевому уровню (по умолчанию -20 dBFS RMS) с жёстким пик-лимитом
 * (по умолчанию -1 dBFS): громкость каждой фразы приводится примерно к одному уровню, но усиление
 * НИКОГДА не позволяет пику превысить лимит — при конфликте (тихая, но с уже почти full-scale
 * пиком фраза — напр. импульсный шум/щелчок) побеждает пик-лимит, а не целевой RMS: "не клиппить"
 * важнее точного попадания в target.
 *
 * Почти тишина (RMS ниже silenceRmsThresholdDbfs — напр. фраза-пауза или фоновый шум без речи) НЕ
 * усиливается вовсе: наивная RMS-нормализация подняла бы фоновый шум до целевого уровня, отчего
 * тихая "фраза" звучала бы ГРОМЧЕ окружающих осмысленных фраз — то есть хуже исходной проблемы
 * разнобоя громкости, которую нормализация должна решать.
 *
 * Возвращает НОВЫЙ Int16Array при реальном изменении усиления; при "нет усиления"/"уже близко
 * к цели"/"тишина" возвращает ТОТ ЖЕ samples без копирования (нет смысла аллоцировать зря).
 */
export function normalizePcmRms(samples: Int16Array, options: NormalizePcmOptions = {}): Int16Array {
  const targetDbfs = options.targetDbfs ?? DEFAULT_TARGET_DBFS
  const peakLimitDbfs = options.peakLimitDbfs ?? DEFAULT_PEAK_LIMIT_DBFS
  const silenceThresholdDbfs = options.silenceRmsThresholdDbfs ?? DEFAULT_SILENCE_RMS_THRESHOLD_DBFS

  const rms = computeRms(samples)
  if (rms <= 0 || linearToDbfs(rms) < silenceThresholdDbfs) return samples // почти тишина — не трогаем

  const peak = computePeakAbs(samples)
  if (peak <= 0) return samples

  const targetRmsLinear = dbfsToLinear(targetDbfs)
  const peakLimitLinear = dbfsToLinear(peakLimitDbfs)

  let gain = targetRmsLinear / rms
  const maxGainForPeak = peakLimitLinear / peak
  if (gain > maxGainForPeak) gain = maxGainForPeak // пик-лимит побеждает — см. докстринг выше

  if (!Number.isFinite(gain) || gain <= 0) return samples
  if (Math.abs(gain - 1) < 0.01) return samples // уже достаточно близко — не тратим на копирование

  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    // Клампим на всякий случай (defensive) — основная защита от клиппинга уже в maxGainForPeak выше.
    out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain)))
  }
  return out
}
