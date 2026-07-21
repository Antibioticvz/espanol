import type { Lang } from '../../../core/types/generation'
import { usePhraseAudioMutation } from '../../hooks/usePhraseAudio'

export interface PhrasePlayerProps {
  topicId: string
  phraseId: string
  lang: Lang
  label: string
}

/** Встроенный плеер фразы — ленивая загрузка байтов по клику (см. shared/ipc.ts#getPhraseAudio). */
export function PhrasePlayer({ topicId, phraseId, lang, label }: PhrasePlayerProps): JSX.Element {
  const mutation = usePhraseAudioMutation()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => mutation.mutate({ topicId, phraseId, lang })}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? '…' : '🎵'} {label}
      </button>
      {mutation.data && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          controls
          autoPlay
          src={mutation.data.audioDataUrl}
          className="h-8 max-w-[220px]"
          data-testid={`phrase-audio-${phraseId}-${lang}`}
        />
      )}
    </div>
  )
}
