export type CliFlags = Record<string, string | boolean>

export interface ParsedArgs {
  command: string | undefined
  flags: CliFlags
}

/** Простой парсер `команда --флаг значение --булев-флаг --флаг2 значение2`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv
  const flags: CliFlags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return { command, flags }
}

export function strFlag(flags: CliFlags, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

export function numFlag(flags: CliFlags, key: string, def: number): number {
  const v = flags[key]
  if (typeof v !== 'string') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

export function boolFlag(flags: CliFlags, key: string): boolean {
  return flags[key] === true || flags[key] === 'true'
}
