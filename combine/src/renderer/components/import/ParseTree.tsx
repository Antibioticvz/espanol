import type { ParsedLesson } from '../../../core/types/parsed-lesson'

const BLOCK_TYPE_LABEL: Record<string, string> = {
  verb_group: 'Глаголы',
  phrase_group: 'Фразы',
  vocabulary: 'Лексика',
  story: 'Рассказ'
}

/** Дерево структуры распарсенного урока — блоки → группы (см. docs/SPEC_COMBINE.md §4.1). */
export function ParseTree({ lesson }: { lesson: ParsedLesson }): JSX.Element {
  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">
        Тема {lesson.topicNumber}: {lesson.titleRu}
        {lesson.titleEs ? <span className="font-normal text-slate-500"> — {lesson.titleEs}</span> : null}
      </h3>
      <ul className="space-y-2 text-sm">
        {lesson.blocks.map((block) => (
          <li key={block.blockId}>
            <div className="font-medium text-slate-800">
              {BLOCK_TYPE_LABEL[block.type] ?? block.type} — {block.titleRu}
            </div>
            {(block.type === 'verb_group' || block.type === 'phrase_group') && (
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-slate-600">
                {block.groups.map((g) => (
                  <li key={g.key}>
                    {g.titleRu ?? g.translationRu ?? g.key} ({g.phrases.length} фраз)
                  </li>
                ))}
              </ul>
            )}
            {block.type === 'vocabulary' && (
              <div className="ml-4 mt-1 text-slate-600">{block.words.length} слов</div>
            )}
            {block.type === 'story' && (
              <div className="ml-4 mt-1 text-slate-600">{block.textEs.length} символов (ES)</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
