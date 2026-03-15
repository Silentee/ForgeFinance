import { format, parseISO } from 'date-fns'

// ─── Currency ─────────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Format a number as $1,234.56 */
export function formatCurrency(value: number | undefined | null): string {
  if (value == null) return '—'
  return USD.format(value)
}

/** Format a number as $1,234 (no cents) */
export function formatCurrencyWhole(value: number | undefined | null): string {
  if (value == null) return '—'
  return USD_WHOLE.format(value)
}

/** Format a number as $1.2M / $34.5K for compact display */
export function formatCurrencyCompact(value: number | undefined | null): string {
  if (value == null) return '—'
  return USD_COMPACT.format(value)
}

/** Format with explicit +/- sign: +$1,234.56 or -$1,234.56 */
export function formatCurrencySigned(value: number | undefined | null): string {
  if (value == null) return '—'
  const abs = formatCurrency(Math.abs(value))
  if (value > 0) return `+${abs}`
  if (value < 0) return `-${abs}`
  return abs
}

/** Format with explicit +/- sign, no cents: +$1,234 or -$1,234 */
export function formatCurrencySignedWhole(value: number | undefined | null): string {
  if (value == null) return '—'
  const abs = formatCurrencyWhole(Math.abs(value))
  if (value > 0) return `+${abs}`
  if (value < 0) return `-${abs}`
  return abs
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/** "Feb 22, 2026" */
export function formatDate(isoString: string | undefined | null): string {
  if (!isoString) return '—'
  try {
    return format(parseISO(isoString), 'MMM d, yyyy')
  } catch {
    return isoString
  }
}

/** "Feb 2026" */
export function formatMonthYear(isoString: string): string {
  try {
    return format(parseISO(isoString + '-01'), 'MMM yyyy')
  } catch {
    return isoString
  }
}

/** "02/22/2026" */
export function formatDateShort(isoString: string | undefined | null): string {
  if (!isoString) return '—'
  try {
    return format(parseISO(isoString), 'MM/dd/yyyy')
  } catch {
    return isoString
  }
}

// ─── Percentages ──────────────────────────────────────────────────────────────

/** "45.2%" */
export function formatPercent(value: number | undefined | null, decimals = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(decimals)}%`
}

// ─── Account type labels ──────────────────────────────────────────────────────

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  // Assets
  checking:        'Checking',
  savings:         'Savings',
  hysa:            'HYSA',
  cash:            'Cash',
  precious_metal:  'Precious Metal',
  investment:      'Investment',
  retirement:      'Retirement',
  hsa:             'HSA',
  real_estate:     'Real Estate',
  vehicle:         'Vehicle',
  other_asset:     'Other Asset',
  // Liabilities
  credit_card:     'Credit Card',
  mortgage:        'Mortgage',
  car_loan:        'Car Loan',
  student_loan:    'Student Loan',
  personal_loan:   'Personal Loan',
  other_liability: 'Other Liability',
}

export function formatAccountType(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? type
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

/** Clamp a progress value 0–100, for use with progress bars */
export function clampPercent(value: number | undefined | null): number {
  if (value == null || isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

/** Group an array by a key function */
export function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item)
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

/** Get current year/month as {year, month} */
export function currentYearMonth(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}
