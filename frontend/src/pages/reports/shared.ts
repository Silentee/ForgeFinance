// Helpers shared by the report tab components.

export type YearMonth = { year: number; month: number }

export const compareYearMonth = (a: YearMonth, b: YearMonth) => (a.year - b.year) || (a.month - b.month)
export const diffMonths = (start: YearMonth, end: YearMonth) => (end.year - start.year) * 12 + (end.month - start.month)
export const addMonths = (ym: YearMonth, delta: number): YearMonth => {
  const d = new Date(ym.year, ym.month - 1, 1)
  d.setMonth(d.getMonth() + delta)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
export const yearMonthToInput = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, '0')}`
export const parseYearMonthInput = (value: string): YearMonth | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

export const CHART_COLORS = [
  '#f5a623', '#34d4b1', '#f87171', '#818cf8', '#34d4b1',
  '#fb923c', '#a78bfa', '#22d3ee', '#4ade80', '#f472b6',
]

// Heckbert's "nice numbers" algorithm — picks a round step size (1/2/5/10 x a power of ten)
// so axis ticks land on whole, easy-to-compare numbers instead of raw fractions of the range.
const niceNum = (range: number, round: boolean): number => {
  if (range <= 0) return 1
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / Math.pow(10, exponent)
  const niceFraction = round
    ? (fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10)
    : (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10)
  return niceFraction * Math.pow(10, exponent)
}

// Uniformly-spaced, round-number ticks that comfortably bound [min, max].
export const niceTicks = (min: number, max: number, tickCount = 5): { domain: [number, number]; ticks: number[] } => {
  if (min === max) { min -= 1; max += 1 }
  const step = niceNum(niceNum(max - min, false) / (tickCount - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v))
  return { domain: [niceMin, niceMax], ticks }
}
