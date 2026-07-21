import type { ParseIssue } from '../../../core/types/parsed-lesson'

export interface ParseErrorListProps {
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

function IssueRow({ issue, tone }: { issue: ParseIssue; tone: 'error' | 'warning' }): JSX.Element {
  const icon = tone === 'error' ? '⚠' : '△'
  const colorClass = tone === 'error' ? 'text-red-700' : 'text-amber-700'
  return (
    <li className={colorClass} data-testid={`issue-${tone}`}>
      <span className="mr-1">{icon}</span>
      {issue.line !== null ? <strong>Строка {issue.line}: </strong> : null}
      {issue.message}
    </li>
  )
}

/** Дерево ошибок/предупреждений парсера с номерами строк — см. docs/SPEC_COMBINE.md §4.1. */
export function ParseErrorList({ errors, warnings }: ParseErrorListProps): JSX.Element {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="card">
        <p className="text-sm font-medium text-green-700">✓ Ошибок и предупреждений нет — готово к генерации.</p>
      </div>
    )
  }

  return (
    <div className="card space-y-3">
      {errors.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-red-700">Ошибки ({errors.length})</h4>
          <ul className="space-y-1 text-sm">
            {errors.map((issue, i) => (
              <IssueRow key={`error-${i}-${issue.line ?? 'x'}`} issue={issue} tone="error" />
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-amber-700">Предупреждения ({warnings.length})</h4>
          <ul className="space-y-1 text-sm">
            {warnings.map((issue, i) => (
              <IssueRow key={`warning-${i}-${issue.line ?? 'x'}`} issue={issue} tone="warning" />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
