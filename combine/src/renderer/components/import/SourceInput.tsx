import { useRef } from 'react'
import { SAMPLE_TOPIC_02_RAW } from '../../lib/sample-texts'

interface SourceInputProps {
  value: string
  onChange: (text: string) => void
}

/** Загрузка файла (.txt/.md/.md.txt) или ручная вставка текста — см. docs/SPEC_COMBINE.md §4.1. */
export function SourceInput({ value, onChange }: SourceInputProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File): Promise<void> => {
    const text = await file.text()
    onChange(text)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
          📄 Загрузить файл
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.md.txt"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
        <button type="button" className="btn-secondary" onClick={() => onChange(SAMPLE_TOPIC_02_RAW)}>
          Вставить пример
        </button>
        {value.length > 0 && (
          <button type="button" className="btn-secondary" onClick={() => onChange('')}>
            Очистить
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'Вставьте текст урока вручную — например, начните с «#TOPIC 1 | Название темы»'}
        spellCheck={false}
        aria-label="Текст урока"
        className="h-[420px] w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm leading-relaxed text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </div>
  )
}
