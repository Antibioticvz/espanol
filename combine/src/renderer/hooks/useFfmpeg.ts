import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/**
 * v1.2 (D-24): доступность ffmpeg для нормализации громкости ElevenLabs (main-процесс проверяет
 * PATH — renderer не имеет доступа к child_process, см. core/util/ffmpeg.ts).
 * enabled — вызывающий решает, когда это вообще актуально (provider=elevenlabs + normalizeAudio=on).
 */
export function useFfmpegAvailableQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['ffmpegAvailable'],
    queryFn: () => api.checkFfmpegAvailable(),
    enabled
  })
}
