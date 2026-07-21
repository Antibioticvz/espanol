import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TTSProvider, TtsModel, TtsSynthesizeParams, TtsSynthesizeResult, TtsVoice } from './tts-provider'
import { TtsError } from './tts-provider'
import type { MockLang, ResolvedMockVoice, SystemVoice } from './say-voices'
import { parseSayVoiceList, pickVoiceForLang } from './say-voices'
import { parseWav, encodePcmToMp3, normalizePcmRms, pcmDurationMs } from '../util/wav-mp3'

const execFileAsync = promisify(execFileCb)

export interface MockSayServiceOptions {
  /** Переопределяемо для тестов: возвращает сырой вывод `say -v '?'` без реального вызова процесса. */
  listVoicesRaw?: () => Promise<string>
  /** Частота дискретизации синтеза (по умолчанию 22050, как в scripts/make-fixture.mjs). */
  sampleRate?: number
  /** Битрейт MP3-кодирования. */
  kbps?: number
  /**
   * v1.2 (D-23): RMS-нормализация громкости перед кодированием в MP3 (AppSettings.normalizeAudio).
   * По умолчанию true — для mock_say нормализация бесплатна (чистый JS, без внешних зависимостей)
   * и не имеет режима отказа, поэтому включена всегда, пока настройка в целом не выключена явно.
   */
  normalize?: boolean
}

async function defaultListVoicesRaw(): Promise<string> {
  const { stdout } = await execFileAsync('say', ['-v', '?'])
  return stdout
}

/**
 * Провайдер mock_say — синтез речи через локальный macOS `say` (Mónica/Milena по умолчанию) →
 * WAV → MP3 (lamejs). Бесплатный офлайн-режим для разработки/проверки (см. docs/DECISIONS.md D-04).
 *
 * Graceful fallback голосов: если Mónica/Milena не установлены на машине (CI, чужой Mac),
 * автоматически выбирается первый установленный голос нужной локали, а если и такого нет —
 * системный голос по умолчанию (без -v), с предупреждением (см. resolveVoice()).
 */
export class MockSayService implements TTSProvider {
  readonly id = 'mock_say' as const

  private voicesCache: SystemVoice[] | null = null
  private resolvedCache = new Map<MockLang, ResolvedMockVoice>()

  constructor(private readonly options: MockSayServiceOptions = {}) {}

  private async getSystemVoices(): Promise<SystemVoice[]> {
    if (this.voicesCache) return this.voicesCache
    let raw: string
    try {
      raw = this.options.listVoicesRaw ? await this.options.listVoicesRaw() : await defaultListVoicesRaw()
    } catch {
      // Не удалось получить список голосов вообще (say отсутствует и т.п.) — трактуем как "голосов нет".
      this.voicesCache = []
      return this.voicesCache
    }
    this.voicesCache = parseSayVoiceList(raw)
    return this.voicesCache
  }

  /** Определяет фактический голос для языка с graceful fallback. Кэшируется на весь сеанс генерации. */
  async resolveVoice(lang: MockLang, preferredId?: string | null): Promise<ResolvedMockVoice> {
    const cached = this.resolvedCache.get(lang)
    if (cached) return cached
    const voices = await this.getSystemVoices()
    const resolved = pickVoiceForLang(voices, lang, preferredId)
    this.resolvedCache.set(lang, resolved)
    return resolved
  }

  async listVoices(): Promise<TtsVoice[]> {
    const voices = await this.getSystemVoices()
    return voices
      .filter((v) => v.locale.toLowerCase().startsWith('es_') || v.locale.toLowerCase().startsWith('ru_'))
      .map((v) => ({ id: v.name, name: `${v.name} (${v.locale})`, previewUrl: null, category: 'system' }))
  }

  async listModels(): Promise<TtsModel[]> {
    return [{ id: 'macos_say', name: 'macOS say (mock, офлайн, бесплатно)' }]
  }

  async synthesize(params: TtsSynthesizeParams): Promise<TtsSynthesizeResult> {
    if (params.lang !== 'es' && params.lang !== 'ru') {
      throw new TtsError(`mock_say поддерживает только языки es/ru, получено "${params.lang}"`, 'bad_request')
    }
    const resolved = await this.resolveVoice(params.lang, params.voiceId)
    const sampleRate = this.options.sampleRate ?? 22050
    const kbps = this.options.kbps ?? 64
    const dir = await mkdtemp(join(tmpdir(), 'combine-say-'))
    const wavPath = join(dir, 'utt.wav')
    try {
      const args = ['-o', wavPath, '--file-format=WAVE', `--data-format=LEI16@${sampleRate}`]
      if (!resolved.usedFallback) args.unshift('-v', resolved.name)
      args.push(params.text)
      try {
        await execFileAsync('say', args, { timeout: params.timeoutMs ?? 30000 })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        throw new TtsError(`Ошибка вызова macOS say: ${message}`, 'unknown', undefined, false)
      }
      const wavBuf = await readFile(wavPath)
      const { samples, sampleRate: actualRate } = parseWav(wavBuf)
      // v1.2 (D-23): RMS-нормализация ДО кодирования в MP3 — см. докстринг normalizePcmRms
      // (целевой уровень ~-20 dBFS RMS, пик-лимит -1 dBFS, тишина не усиливается).
      const normalized = this.options.normalize === false ? samples : normalizePcmRms(samples)
      const audio = await encodePcmToMp3(normalized, actualRate, kbps)
      const durationMs = pcmDurationMs(normalized, actualRate)
      return { audio, durationMs, characters: params.text.length }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
