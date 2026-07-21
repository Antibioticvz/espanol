/**
 * Генерация короткого «бипа» как data:audio/wav;base64 — используется mockAdapter вместо реальных
 * запросов к TTS (preview голосов, testSnippet, плеер фраз библиотеки). Никаких внешних ассетов —
 * WAV-байты строятся на лету из синусоиды с fade-in/out, чтобы не щёлкало на границах.
 */

function buildWavBytes(durationMs: number, freqHz: number, sampleRate = 8000): Uint8Array {
  const numSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate))
  const blockAlign = 2 // 16-bit mono
  const dataSize = numSamples * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  // RIFF header
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const fadeSamples = Math.min(numSamples / 4, sampleRate * 0.02)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    let envelope = 1
    if (i < fadeSamples) envelope = i / fadeSamples
    else if (i > numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples
    const sample = Math.sin(2 * Math.PI * freqHz * t) * envelope * 0.3
    const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    view.setInt16(44 + i * blockAlign, intSample, true)
  }

  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  // btoa доступен и в браузере, и в jsdom (тестовое окружение).
  return btoa(binary)
}

export function createBeepDataUrl(opts?: { durationMs?: number; freqHz?: number; sampleRate?: number }): string {
  const durationMs = opts?.durationMs ?? 500
  const freqHz = opts?.freqHz ?? 440
  const sampleRate = opts?.sampleRate ?? 8000
  const bytes = buildWavBytes(durationMs, freqHz, sampleRate)
  return `data:audio/wav;base64,${bytesToBase64(bytes)}`
}

/** Оценка длительности по тем же параметрам, что и синтез — используется в мок-результатах. */
export function beepDurationMs(text: string): number {
  // Грубая имитация: ~60 мс/символ + базовая задержка, в духе реальной TTS-длительности.
  return Math.max(400, Math.round(text.length * 60 + 300))
}
