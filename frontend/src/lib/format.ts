import { differenceInDays, format, parseISO } from 'date-fns'

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

// Coarsest to finest, with the nominal length used to turn an elapsed span
// into whole units. Averaged lengths are fine here — the output is a rough
// "how long ago", never a calculation anything depends on.
const AGO_UNITS = [
  { unit: 'year', days: 365.25 },
  { unit: 'month', days: 30.44 },
  { unit: 'week', days: 7 },
  { unit: 'day', days: 1 },
] as const

export type TimeAgoUnit = (typeof AGO_UNITS)[number]['unit']

/** "2 months ago" / "6 weeks ago" — elapsed time since an ISO date, counted in
 *  `unit`, stepping down to a finer one until a whole unit has actually passed
 *  (so a 12-day-old change reads "2 weeks ago", not "0 months ago", and a
 *  200-day-old one isn't rounded up to "1 year ago"). The count itself rounds,
 *  so 59 days reads "2 months ago" rather than being floored to one. */
export function formatTimeAgo(isoString: string, unit: TimeAgoUnit = 'day'): string {
  try {
    const elapsed = differenceInDays(new Date(), parseISO(isoString))
    const start = AGO_UNITS.findIndex(u => u.unit === unit)
    for (const step of AGO_UNITS.slice(start === -1 ? 0 : start)) {
      if (elapsed < step.days) continue
      const n = Math.round(elapsed / step.days)
      return `${n} ${step.unit}${n === 1 ? '' : 's'} ago`
    }
    return 'today'
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

// ─── Category ordering ────────────────────────────────────────────────────────

/**
 * Sort categories (or any {sort_order, name} records) by their persisted
 * sort_order, breaking ties by name. Used everywhere categories are rendered so
 * that reordering in the manager propagates across the app.
 */
export function sortBySortOrder<T extends { sort_order: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
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

/**
 * Format a Date as a YYYY-MM-DD string using its LOCAL calendar date.
 * Unlike `Date.toISOString().slice(0, 10)`, this does not shift across the
 * UTC boundary — so an evening date stays on the correct day.
 */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's date as a local YYYY-MM-DD string. */
export function todayLocal(): string {
  return toLocalDateString(new Date())
}
