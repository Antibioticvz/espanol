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

/**
 * Мульти-верификаторное ревью (минор): раньше "флаг присутствует, но без числового значения"
 * (напр. `--stability --no-normalize` — "--no-normalize" не проглатывается как значение, т.к.
 * начинается с "--", и parseArgs() кладёт flags.stability=true) и "нечисловая строка" молча
 * подставляли def — неотличимо от опечатки/пропущенного значения. Теперь оба случая печатают
 * явное предупреждение, а не тихо делают вид, что пользователь именно этот def и указал.
 */
export function numFlag(flags: CliFlags, key: string, def: number): number {
  const v = flags[key]
  if (v === true) {
    console.warn(
      `⚠ Флаг --${key} указан без числового значения (следующий токен начинается с "--" или отсутствует) — используется значение по умолчанию (${def}). Проверьте, не пропущено ли значение.`
    )
    return def
  }
  if (typeof v !== 'string') return def
  const n = Number(v)
  if (!Number.isFinite(n)) {
    console.warn(`⚠ Флаг --${key} имеет нечисловое значение «${v}» — используется значение по умолчанию (${def}).`)
    return def
  }
  return n
}

export function boolFlag(flags: CliFlags, key: string): boolean {
  return flags[key] === true || flags[key] === 'true'
}
