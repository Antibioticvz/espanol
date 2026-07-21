/** Форматирование чисел/денег/длительностей — общие хелперы для всех экранов UI. */

const currencyFormatter2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const currencyFormatter4 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
})

/**
 * 2 знака после запятой для обычных сумм (как в мокапах спеки: "$0.75", "$7.23"); 4 знака — только для
 * мелких сумм < $0.01 (тестовая генерация D-05 стоит ~$0.003 — округление до "$0.00" было бы вводящим в заблуждение).
 */
export function formatUsd(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) {
    return currencyFormatter4.format(value)
  }
  return currencyFormatter2.format(value)
}

const integerFormatter = new Intl.NumberFormat('ru-RU')

export function formatNumber(value: number): string {
  return integerFormatter.format(value)
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function formatDurationSeconds(totalSeconds: number | null): string {
  if (totalSeconds === null || Number.isNaN(totalSeconds) || totalSeconds < 0) return '—'
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} ч ${m} мин`
  if (m > 0) return `${m} мин ${sec ? `${sec} сек` : ''}`.trim()
  return `${sec} сек`
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return `${(ms / 1000).toFixed(1)} сек`
}

export function formatBytes(mb: number | null): string {
  if (mb === null) return '—'
  if (mb < 1) return `${Math.round(mb * 1024)} КБ`
  if (mb < 1024) return `${mb.toFixed(1)} МБ`
  return `${(mb / 1024).toFixed(2)} ГБ`
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
