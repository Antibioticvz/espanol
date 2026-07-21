import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Нормализация громкости уже готового MP3 (v1.2, D-23) — используется ElevenLabsService, у
 * которого нет доступа к сырым PCM-сэмплам (провайдер отдаёт готовый MP3 напрямую) и нет чистого
 * JS MP3-декодера в проекте. Единственный практичный способ нормализовать УЖЕ закодированный
 * MP3 — внешний `ffmpeg` (EBU R128 loudnorm). Интерфейс, а не голая функция, — чтобы
 * ElevenLabsService мог принимать инжектируемую реализацию в тестах (см. eleven-labs.service.test.ts)
 * так же, как уже принимает `fetchImpl`, не завися от реального бинарника ffmpeg на машине с тестами.
 */
export interface LoudnessNormalizer {
  isAvailable(): Promise<boolean>
  normalize(mp3: Buffer): Promise<Buffer>
}

let availabilityCache: Promise<boolean> | null = null

function probeFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
      child.on('error', () => resolve(false)) // ENOENT — ffmpeg не установлен
      child.on('exit', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

/**
 * Кэшируется на весь процесс — при уроке из 80+ фраз не имеет смысла спавнить `ffmpeg -version`
 * перед КАЖДОЙ. Наличие ffmpeg не меняется в течение жизни процесса.
 */
export function isFfmpegAvailable(): Promise<boolean> {
  if (!availabilityCache) availabilityCache = probeFfmpeg()
  return availabilityCache
}

/** Только для тестов — сброс кэша между кейсами "ffmpeg есть"/"ffmpeg нет". */
export function resetFfmpegAvailabilityCache(): void {
  availabilityCache = null
}

/**
 * EBU R128 loudness normalization (`loudnorm`, integrated loudness I=-18 LUFS, true peak -1 dBTP) —
 * см. docs/DECISIONS.md D-23. Пишет во временные файлы (надёжнее межплатформенного стриминга MP3
 * через stdio) и подчищает их за собой в finally.
 */
export class FfmpegLoudnessNormalizer implements LoudnessNormalizer {
  isAvailable(): Promise<boolean> {
    return isFfmpegAvailable()
  }

  async normalize(mp3: Buffer): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'combine-loudnorm-'))
    const inPath = join(dir, 'in.mp3')
    const outPath = join(dir, 'out.mp3')
    try {
      await writeFile(inPath, mp3)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'ffmpeg',
          ['-y', '-i', inPath, '-af', 'loudnorm=I=-18:TP=-1:LRA=11', '-codec:a', 'libmp3lame', '-qscale:a', '2', outPath],
          { stdio: 'ignore' }
        )
        child.on('error', reject)
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg завершился с кодом ${String(code)}`))))
      })
      return await readFile(outPath)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
