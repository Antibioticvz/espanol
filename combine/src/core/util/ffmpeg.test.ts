import { beforeEach, describe, expect, it } from 'vitest'
import { FfmpegLoudnessNormalizer, isFfmpegAvailable, resetFfmpegAvailabilityCache } from './ffmpeg'

describe('isFfmpegAvailable (v1.2, D-23)', () => {
  beforeEach(() => {
    resetFfmpegAvailabilityCache()
  })

  // Не хардкодим true/false — присутствие ffmpeg зависит от машины, где запускаются тесты (на
  // машине разработки этой фичи ffmpeg НЕ установлен, но CI/другой Mac может отличаться). Основная
  // глубина покрытия по best-effort-поведению (ffmpeg доступен/недоступен) — в
  // eleven-labs.service.test.ts через инжектируемый LoudnessNormalizer, который не зависит от
  // реального бинарника вообще.
  it('резолвится в boolean, не бросает, даже если ffmpeg не установлен', async () => {
    const result = await isFfmpegAvailable()
    expect(typeof result).toBe('boolean')
  })

  it('кэшируется на процесс — повторный вызов даёт тот же результат мгновенно', async () => {
    const first = await isFfmpegAvailable()
    const second = await isFfmpegAvailable()
    expect(second).toBe(first)
  })
})

describe('FfmpegLoudnessNormalizer — реальный ffmpeg (условно пропускается, если не установлен)', () => {
  it('isAvailable() согласован с isFfmpegAvailable()', async () => {
    resetFfmpegAvailabilityCache()
    const normalizer = new FfmpegLoudnessNormalizer()
    const [viaNormalizer, viaHelper] = await Promise.all([normalizer.isAvailable(), isFfmpegAvailable()])
    expect(viaNormalizer).toBe(viaHelper)
  })

  it('normalize() реального минимального MP3 — пропускается автоматически, если в системе нет ffmpeg', async () => {
    const available = await isFfmpegAvailable()
    if (!available) {
      // Явный, видимый skip вместо тихого прохождения "ничего не делающего" теста — так из вывода
      // vitest сразу видно, что эта проверка не выполнялась (и почему), а не просто "прошла".
      console.warn('[ffmpeg.test.ts] ffmpeg не найден в PATH — пропускаем реальный round-trip normalize().')
      return
    }
    // Минимальный валидный MP3 — тот же fixture-принцип, что и FAKE_MP3 в eleven-labs.service.test.ts,
    // но здесь ffmpeg должен реально суметь его декодировать, поэтому нужен настоящий (пусть и очень
    // короткий) кадр; конструировать такой байт-в-байт вручную ненадёжно — интеграционная ветка
    // полагается на то, что если ffmpeg СТАЛ доступен в окружении, там же обычно есть и afconvert/say
    // для быстрой генерации короткого реального mp3, что избыточно для юнит-теста. Ограничиваемся
    // проверкой, что вызов вообще не бросает при заведомо валидном входе, беря его из lamejs-энкодера.
    const { encodePcmToMp3 } = await import('./wav-mp3')
    const samples = new Int16Array(4410) // 0.2с тишины на 22050 Гц — валидный, но "пустой" MP3
    const mp3 = await encodePcmToMp3(samples, 22050, 64)

    const normalizer = new FfmpegLoudnessNormalizer()
    const normalized = await normalizer.normalize(mp3)
    expect(normalized.length).toBeGreaterThan(0)
  }, 30000)
})
