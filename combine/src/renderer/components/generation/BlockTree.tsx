import { useState } from 'react'
import type { TreeBlock, TreeGroup, TreePhrase } from '../../lib/lessonTree'
import { countBlockItems, countGroupItems } from '../../lib/lessonTree'

const BLOCK_TYPE_LABEL: Record<string, string> = {
  verb_group: 'Глаголы',
  phrase_group: 'Фразы',
  vocabulary: 'Лексика',
  story: 'Рассказ'
}

const STATUS_ICON: Record<string, string> = {
  done: '✓',
  generating: '⏱',
  failed: '⚠',
  pending: '◯'
}

const STATUS_COLOR: Record<string, string> = {
  done: 'text-green-700',
  generating: 'text-blue-700',
  failed: 'text-red-700',
  pending: 'text-slate-400'
}

export interface BlockTreeProps {
  blocks: TreeBlock[]
}

/** Развёртываемое дерево блоков со статусами ✓⏱⚠◯ (см. docs/SPEC_COMBINE.md §4.3). */
export function BlockTree({ blocks }: BlockTreeProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="card space-y-2" data-testid="block-tree">
      <h3 className="text-sm font-semibold text-slate-900">Дерево блоков</h3>
      {blocks.length === 0 && <p className="text-sm text-slate-400">Нет данных.</p>}
      <ul className="space-y-2 text-sm">
        {blocks.map((block) => {
          const { done, total } = countBlockItems(block)
          const isCollapsed = collapsed.has(block.blockId)
          return (
            <li key={block.blockId}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left font-medium text-slate-800"
                onClick={() => toggle(block.blockId)}
              >
                <span>
                  {isCollapsed ? '▶' : '▼'} BLOCK: {BLOCK_TYPE_LABEL[block.type] ?? block.type} — {block.title} ({total})
                </span>
                <MiniBar done={done} total={total} />
              </button>
              {!isCollapsed && (
                <div className="ml-4 mt-1 space-y-1">
                  {block.groups?.map((group) => (
                    <GroupRow key={group.key} group={group} />
                  ))}
                  {block.words && <PhraseList phrases={block.words} />}
                  {block.story && <PhraseRow phrase={block.story} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GroupRow({ group }: { group: TreeGroup }): JSX.Element {
  const [open, setOpen] = useState(true)
  const { done, total } = countGroupItems(group)
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left text-slate-700"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {open ? '▼' : '▶'} {group.title} ({total})
        </span>
        <MiniBar done={done} total={total} />
      </button>
      {open && <PhraseList phrases={group.phrases} indent />}
    </div>
  )
}

function PhraseList({ phrases, indent }: { phrases: TreePhrase[]; indent?: boolean }): JSX.Element {
  return (
    <ul className={indent ? 'ml-4 space-y-0.5' : 'space-y-0.5'}>
      {phrases.map((p) => (
        <li key={p.id}>
          <PhraseRow phrase={p} />
        </li>
      ))}
    </ul>
  )
}

function PhraseRow({ phrase }: { phrase: TreePhrase }): JSX.Element {
  return (
    <div className={`flex items-center gap-2 ${STATUS_COLOR[phrase.status]}`} data-testid={`phrase-${phrase.id}`}>
      <span aria-hidden="true">{STATUS_ICON[phrase.status]}</span>
      <span className="shrink-0 truncate text-slate-700">{phrase.id}</span>
      <span className="truncate text-slate-400">— {phrase.es}</span>
      {phrase.status === 'done' && phrase.durationMs != null && (
        <span className="ml-auto shrink-0 text-xs text-slate-400">{(phrase.durationMs / 1000).toFixed(1)} сек</span>
      )}
      {phrase.status === 'failed' && phrase.error && (
        <span className="ml-auto shrink-0 truncate text-xs text-red-500">{phrase.error}</span>
      )}
    </div>
  )
}

function MiniBar({ done, total }: { done: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-slate-400">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span className="block h-full bg-brand-500" style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  )
}
