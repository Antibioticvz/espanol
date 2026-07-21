import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boolFlag, numFlag, parseArgs, strFlag } from './args'

describe('parseArgs / strFlag / boolFlag', () => {
  it('разбирает флаг--значение и булев флаг без значения', () => {
    const { command, flags } = parseArgs(['generate', '--input', 'x.txt', '--export-zip'])
    expect(command).toBe('generate')
    expect(strFlag(flags, 'input')).toBe('x.txt')
    expect(boolFlag(flags, 'export-zip')).toBe(true)
  })
})

describe('numFlag (мульти-верификаторное ревью, минор) — предупреждение вместо тихого дефолта', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('нормальное числовое значение — возвращает его, без предупреждения', () => {
    const { flags } = parseArgs(['generate', '--stability', '0.7'])
    expect(numFlag(flags, 'stability', 0.5)).toBe(0.7)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('флаг отсутствует вовсе — возвращает def молча (это НЕ опечатка, а осознанное отсутствие)', () => {
    const { flags } = parseArgs(['generate'])
    expect(numFlag(flags, 'stability', 0.5)).toBe(0.5)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('РЕГРЕССИЯ: флаг присутствует, но БЕЗ числового значения (следующий токен — другой флаг) -> дефолт + явное предупреждение', () => {
    // Ровно сценарий находки: `--stability --no-normalize` — "--no-normalize" не проглатывается
    // как значение stability (начинается с "--"), flags.stability становится boolean true.
    const { flags } = parseArgs(['generate', '--stability', '--no-normalize'])
    expect(flags.stability).toBe(true)
    expect(numFlag(flags, 'stability', 0.5)).toBe(0.5)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/--stability.*без числового значения/)
  })

  it('РЕГРЕССИЯ: нечисловая строка -> дефолт + явное предупреждение', () => {
    const { flags } = parseArgs(['generate', '--stability', 'abc'])
    expect(numFlag(flags, 'stability', 0.5)).toBe(0.5)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/--stability.*нечисловое значение/)
  })
})
