import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useNetWorthHistory, useSpendingTrends, useMonthlyTotals, useBudgetReport, useEquityHistory, useAccounts } from '@/hooks'
import { Card, CardHeader, PageHeader, StatCard, Spinner, FilterDropdown, CheckboxRow } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencyCompact, formatCurrencySignedWhole, currentYearMonth, formatAccountType } from '@/lib/format'
import type { AccountType, Account } from '@/types'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
  ComposedChart, Bar, Line, ReferenceLine,
} from 'recharts'
import clsx from 'clsx'

type YearMonth = { year: number; month: number }

const compareYearMonth = (a: YearMonth, b: YearMonth) => (a.year - b.year) || (a.month - b.month)
const diffMonths = (start: YearMonth, end: YearMonth) => (end.year - start.year) * 12 + (end.month - start.month)
const addMonths = (ym: YearMonth, delta: number): YearMonth => {
  const d = new Date(ym.year, ym.month - 1, 1)
  d.setMonth(d.getMonth() + delta)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}
const yearMonthToInput = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, '0')}`
const parseYearMonthInput = (value: string): YearMonth | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

const NW_OPTIONS: { months: number; label: string; changeLabel: string }[] = [
  { months: 6, label: '6M', changeLabel: '6 Month Change' },
  { months: 12, label: '1Y', changeLabel: '1 Year Change' },
  { months: 60, label: '5Y', changeLabel: '5 Year Change' },
  { months: 240, label: 'ALL', changeLabel: 'All Time Change' },
]
const CHART_COLORS = [
  '#f5a623', '#34d4b1', '#f87171', '#818cf8', '#34d4b1',
  '#fb923c', '#a78bfa', '#22d3ee', '#4ade80', '#f472b6',
]
const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'checking', 'savings', 'hysa', 'cash', 'precious_metal', 'investment', 'retirement', 'hsa', 'real_estate', 'vehicle', 'other_asset',
  'credit_card', 'mortgage', 'car_loan', 'student_loan', 'personal_loan', 'other_liability',
]

// Budget progress bar with a marker showing where the budget line falls relative to spending.
// Under budget: fill shows how far spent, marker pinned to the far right (budget = 100%).
// Over budget: fill is full (red), marker slides left as the overage grows (budget / actual).
function BudgetProgress({ pct }: { pct: number }) {
  const fillPct = Math.min(100, pct)
  const markerPct = pct <= 100 ? 100 : 10000 / pct
  return (
    <div className="relative flex-1">
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={clsx('h-full rounded-full', pct > 120 ? 'bg-red-400' : pct > 102 ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {/* budget-target marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-ink-100/90 rounded-full pointer-events-none"
        style={{ left: `${markerPct}%` }}
      />
    </div>
  )
}

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
const niceTicks = (min: number, max: number, tickCount = 5): { domain: [number, number]; ticks: number[] } => {
  if (min === max) { min -= 1; max += 1 }
  const step = niceNum(niceNum(max - min, false) / (tickCount - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v))
  return { domain: [niceMin, niceMax], ticks }
}

type ReportTab = 'spending' | 'net-worth' | 'cash-flow' | 'emergency-fund'

// A single line the user can chart in the "Accounts & Groups" view.
type SeriesRef =
  | { kind: 'account'; id: number }               // one account
  | { kind: 'group'; accountType: AccountType }    // all accounts of a type
  | { kind: 'filter'; filter: 'liquid' | 'assets' | 'liabilities' } // quick semantic set

const seriesKey = (ref: SeriesRef): string =>
  ref.kind === 'account' ? `a:${ref.id}`
    : ref.kind === 'group' ? `g:${ref.accountType}`
      : `f:${ref.filter}`

const FILTER_LABELS: Record<'liquid' | 'assets' | 'liabilities', string> = {
  liquid: 'All Liquid Assets',
  assets: 'All Assets',
  liabilities: 'All Liabilities',
}

// Net-worth contribution of a raw snapshot balance (assets positive, liabilities negative).
const signedBalance = (acc: Account | undefined, raw: number | undefined): number => {
  if (acc == null || raw == null) return 0
  return acc.is_liability ? -raw : raw
}

export default function ReportsPage() {
  const now = currentYearMonth()
  const { reportTab } = useParams<{ reportTab: string }>()
  const activeTab = (reportTab ?? 'net-worth') as ReportTab
  const [nwMonths, setNwMonths] = useState(12)
  const [nwMode, setNwMode] = useState<'net-worth' | 'equity' | 'series'>('net-worth')
  const [equityAssetId, setEquityAssetId] = useState<number | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<SeriesRef[]>([])
  const [seriesDisplay, setSeriesDisplay] = useState<'compare' | 'combined'>('compare')
  const prevMonth = (() => {
    const d = new Date(now.year, now.month - 1, 1)
    d.setMonth(d.getMonth() - 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const [spendingMonth, setSpendingMonth] = useState(prevMonth.month)
  const [spendingYear, setSpendingYear] = useState(prevMonth.year)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | 'all'>('all')
  const isGroupCollapsed = (name: string) => collapsedGroups === 'all' || collapsedGroups.has(name)
  const [showDiff, setShowDiff] = useState(false)
  const [showAllCategories, setShowAllCategories] = useState(false)

  // Floating table header for spending report
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const floatingHeaderRef = useRef<HTMLDivElement>(null)
  const [showFloatingHeader, setShowFloatingHeader] = useState(false)
  // Frozen category column collapses (base padding shrinks + subcategory indent removed
  // + column narrows) over the first few px of horizontal scroll, then holds at its
  // minimum so the rest of the scroll behaves normally. colCollapse is 0..1 progress.
  const STICKY_COL_COLLAPSE_DISTANCE = 32
  const [colCollapse, setColCollapse] = useState(0)

  useEffect(() => {
    const thead = theadRef.current
    if (!thead) return

    const scrollParent = thead.closest('main')
    if (!scrollParent) return

    const check = () => {
      const headerH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--page-header-height') || '0'
      )
      const theadRect = thead.getBoundingClientRect()
      setShowFloatingHeader(theadRect.top < headerH)
    }

    scrollParent.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    check()

    return () => {
      scrollParent.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [activeTab])

  // Sync horizontal scroll between table and floating header
  const onTableScroll = useCallback(() => {
    if (tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
    const p = Math.min(1, (tableWrapperRef.current?.scrollLeft ?? 0) / STICKY_COL_COLLAPSE_DISTANCE)
    setColCollapse(prev => (prev === p ? prev : p))
  }, [])

  // Sync scroll position when floating header appears
  useEffect(() => {
    if (showFloatingHeader && tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
  }, [showFloatingHeader])

  // Frozen category column geometry, interpolated by scroll-collapse progress (0..1).
  // Base left padding 16→8, subcategory indent 40→8, first column 180→148px.
  const catColWidth = Math.round(180 - 40 * colCollapse)
  const catBasePad = Math.round(16 - 8 * colCollapse) // both left and right edge padding: 16→8
  const catChildPadLeft = Math.round(40 - 32 * colCollapse)
  const catTableMinWidth = Math.round(690 - 40 * colCollapse)
  // Parent-row expand/collapse arrow: its fixed width + margin (20px) is the "indent"
  // that slides the name right; collapse it to 0 alongside the subcategory indent.
  const catArrowWidth = Math.round(16 * (1 - colCollapse))
  const catArrowMargin = Math.round(4 * (1 - colCollapse))

  const cfMaxAnchor = (() => {
    // Anchor cash flow to the last complete month (avoid partial current month)
    const d = new Date(now.year, now.month - 1, 1)
    d.setMonth(d.getMonth() - 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const [cfRangeMode, setCfRangeMode] = useState<'preset' | 'custom'>('preset')
  const [cfAnchor, setCfAnchor] = useState<YearMonth>(cfMaxAnchor)
  const [cfMonths, setCfMonths] = useState<number>(12)
  const [cfCustomStart, setCfCustomStart] = useState(() => yearMonthToInput(addMonths(cfMaxAnchor, -(12 - 1))))
  const [cfCustomEnd, setCfCustomEnd] = useState(() => yearMonthToInput(cfMaxAnchor))
  const [cfCustomError, setCfCustomError] = useState<string | null>(null)
  const [excludedCfCategories, setExcludedCfCategories] = useState<Set<string>>(new Set())
  const [excludedEmergencyCategories, setExcludedEmergencyCategories] = useState<Set<string>>(new Set())
  const [includeAllLiquidAssets, setIncludeAllLiquidAssets] = useState(true)
  const [emergencyTargetMinMonths, setEmergencyTargetMinMonths] = useState<number | ''>(3)
  const [emergencyTargetMaxMonths, setEmergencyTargetMaxMonths] = useState<number | ''>(6)

  const emergencyAnchorDate = new Date(now.year, now.month - 1, 1)
  emergencyAnchorDate.setMonth(emergencyAnchorDate.getMonth() - 1)
  const emergencyAnchorYear = emergencyAnchorDate.getFullYear()
  const emergencyAnchorMonth = emergencyAnchorDate.getMonth() + 1

  const { data: nwHistory, isLoading: nwLoading } = useNetWorthHistory(nwMonths + 1)
  // If viewing the current month, anchor averages to the previous month (incomplete month would skew averages)
  const isCurrentMonth = spendingYear === now.year && spendingMonth === now.month
  const spendingAvgAnchor = (() => {
    if (!isCurrentMonth) return { year: spendingYear, month: spendingMonth }
    const d = new Date(spendingYear, spendingMonth - 1, 1)
    d.setMonth(d.getMonth() - 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const { data: spendingTrends, isLoading: spendingTrendsLoading } = useSpendingTrends({
    months: 12,
    year: spendingAvgAnchor.year,
    month: spendingAvgAnchor.month,
    top_n: 50,
  })
  const { data: budgetReport, isLoading: budgetLoading } = useBudgetReport(spendingYear, spendingMonth)
  const { data: equityHistory, isLoading: equityLoading } = useEquityHistory(nwMonths + 1)
  const { data: cfTrends, isLoading: cfLoading } = useSpendingTrends({ months: cfMonths, year: cfAnchor.year, month: cfAnchor.month, top_n: 50 })
  const { data: accounts } = useAccounts({ active_only: false })
  const { data: emergencyTrends, isLoading: emergencyLoading } = useSpendingTrends({ months: 12, top_n: 20, year: emergencyAnchorYear, month: emergencyAnchorMonth })
  // Net worth chart data — trim leading months with no real balance data, and trailing current (partial) month
  const nwDataRaw = nwHistory?.data_points.map(p => ({
    date: p.date.slice(0, 7),
    assets: p.total_assets,
    liabilities: p.total_liabilities,
    net: p.net_worth,
  })) ?? []
  const firstRealIdx = nwDataRaw.findIndex(p => p.assets !== 0 || p.liabilities !== 0)
  const nwDataAll = firstRealIdx >= 0 ? nwDataRaw.slice(firstRealIdx) : []
  // Drop the last entry (current in-progress month) so the rightmost point is the last complete month
  const nwData = nwDataAll.length > 1 ? nwDataAll.slice(0, -1) : nwDataAll

  // Compute synced Y-axis domains: all three axes share the same magnitude so relative changes are comparable
  const TICK_COUNT = 5
  const evenTicks = (min: number, max: number): number[] => {
    const step = (max - min) / (TICK_COUNT - 1)
    return Array.from({ length: TICK_COUNT }, (_, i) => Math.round(min + step * i))
  }
  const nwSyncedDomain = (() => {
    if (!nwData.length) return { net: ['auto', 'auto'] as ['auto', 'auto'], assets: ['auto', 'auto'] as ['auto', 'auto'], liabs: ['auto', 'auto'] as ['auto', 'auto'], netTicks: undefined as number[] | undefined, assetTicks: undefined as number[] | undefined, liabTicks: undefined as number[] | undefined }
    const rangeOf = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
    const midOf = (vals: number[]) => (Math.min(...vals) + Math.max(...vals)) / 2
    const nets = nwData.map(p => p.net)
    const assets = nwData.map(p => p.assets)
    const liabs = nwData.map(p => p.liabilities)
    const mag = Math.max(rangeOf(nets), rangeOf(assets), rangeOf(liabs)) * 1.1 || 1
    const half = mag / 2
    const netDom: [number, number] = [midOf(nets) - half, midOf(nets) + half]
    const assetDom: [number, number] = [midOf(assets) - half, midOf(assets) + half]
    const liabDom: [number, number] = [midOf(liabs) - half, midOf(liabs) + half]
    return {
      net: netDom, assets: assetDom, liabs: liabDom,
      netTicks: evenTicks(...netDom), assetTicks: evenTicks(...assetDom), liabTicks: evenTicks(...liabDom),
    }
  })()

  // Equity pair chart data — defaults to the first pair until the user picks one
  const effectiveEquityId = equityAssetId ?? equityHistory?.pairs?.[0]?.asset_id ?? null
  const selectedEquityPair = effectiveEquityId != null
    ? equityHistory?.pairs.find(p => p.asset_id === effectiveEquityId) ?? null
    : null
  const equityChartDataRaw = selectedEquityPair?.data_points.map(p => ({
    date: p.date.slice(0, 7),
    asset: p.asset_value,
    liability: p.liability_balance,
    equity: p.equity,
  })) ?? []
  const firstRealEqIdx = equityChartDataRaw.findIndex(p => p.asset !== 0 || p.liability !== 0)
  const equityChartDataAll = firstRealEqIdx >= 0 ? equityChartDataRaw.slice(firstRealEqIdx) : []
  // Drop current in-progress month
  const equityChartData = equityChartDataAll.length > 1 ? equityChartDataAll.slice(0, -1) : equityChartDataAll

  // Synced Y-axis domains for equity chart
  const eqSyncedDomain = (() => {
    if (!equityChartData.length) return { equity: ['auto', 'auto'] as ['auto', 'auto'], asset: ['auto', 'auto'] as ['auto', 'auto'], liability: ['auto', 'auto'] as ['auto', 'auto'], equityTicks: undefined as number[] | undefined, assetTicks: undefined as number[] | undefined, liabilityTicks: undefined as number[] | undefined }
    const rangeOf = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
    const midOf = (vals: number[]) => (Math.min(...vals) + Math.max(...vals)) / 2
    const equities = equityChartData.map(p => p.equity)
    const assets = equityChartData.map(p => p.asset)
    const liabs = equityChartData.map(p => p.liability)
    const mag = Math.max(rangeOf(equities), rangeOf(assets), rangeOf(liabs)) * 1.1 || 1
    const half = mag / 2
    const equityDom: [number, number] = [midOf(equities) - half, midOf(equities) + half]
    const assetDom: [number, number] = [midOf(assets) - half, midOf(assets) + half]
    const liabDom: [number, number] = [midOf(liabs) - half, midOf(liabs) + half]
    return {
      equity: equityDom, asset: assetDom, liability: liabDom,
      equityTicks: evenTicks(...equityDom), assetTicks: evenTicks(...assetDom), liabilityTicks: evenTicks(...liabDom),
    }
  })()

  // ── "Accounts & Groups" series (individual accounts, type groups, quick filters) ──
  const accountMap = new Map((accounts ?? []).map(a => [a.id, a]))
  const activeAccounts = (accounts ?? []).filter(a => a.is_active)
  const presentTypes = ACCOUNT_TYPE_ORDER.filter(t => activeAccounts.some(a => a.account_type === t))

  const resolveSeriesAccountIds = (ref: SeriesRef): number[] => {
    if (ref.kind === 'account') return [ref.id]
    if (ref.kind === 'group') return activeAccounts.filter(a => a.account_type === ref.accountType).map(a => a.id)
    if (ref.filter === 'liquid') return activeAccounts.filter(a => a.is_liquid && !a.is_liability).map(a => a.id)
    if (ref.filter === 'assets') return activeAccounts.filter(a => !a.is_liability).map(a => a.id)
    return activeAccounts.filter(a => a.is_liability).map(a => a.id)
  }
  const seriesLabel = (ref: SeriesRef): string => {
    if (ref.kind === 'account') return accountMap.get(ref.id)?.name ?? `Account ${ref.id}`
    if (ref.kind === 'group') return `All ${formatAccountType(ref.accountType)}`
    return FILTER_LABELS[ref.filter]
  }
  const resolvedSeries = selectedSeries.map((ref, i) => ({
    ref,
    key: seriesKey(ref),
    label: seriesLabel(ref),
    accountIds: resolveSeriesAccountIds(ref),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
  // Selections can overlap (e.g. "All Checking" plus an individual checking account) — dedupe
  // account IDs across all selected series so the combined total never double-counts an account.
  const combinedAccountIds = new Set(resolvedSeries.flatMap(s => s.accountIds))

  // Per-month value for each series, net-worth-signed, aligned to the net worth timeline
  const seriesRowsRaw = (nwHistory?.data_points ?? []).map(p => {
    const row: Record<string, number | string> = { date: p.date.slice(0, 7) }
    for (const s of resolvedSeries) {
      let v = 0
      for (const id of s.accountIds) v += signedBalance(accountMap.get(id), p.by_account[String(id)])
      row[s.key] = Math.round(v * 100) / 100
    }
    let combined = 0
    for (const id of combinedAccountIds) combined += signedBalance(accountMap.get(id), p.by_account[String(id)])
    row.__combined = Math.round(combined * 100) / 100
    return row
  })
  const seriesRowIsEmpty = (row: Record<string, number | string>) =>
    resolvedSeries.every(s => (row[s.key] as number) === 0)
  const firstRealSeriesIdx = seriesRowsRaw.findIndex(r => !seriesRowIsEmpty(r))
  const seriesRowsTrimmed = firstRealSeriesIdx >= 0 ? seriesRowsRaw.slice(firstRealSeriesIdx) : []
  // Drop current in-progress month so the rightmost point is the last complete month
  const seriesChartData = seriesRowsTrimmed.length > 1 ? seriesRowsTrimmed.slice(0, -1) : seriesRowsTrimmed
  const seriesCombined = seriesChartData.map(r => r.__combined as number)

  // Y-axis for the series chart — scale to the plotted data instead of anchoring at 0 (so
  // smaller trends stay visible), with uniformly-spaced, round-number ticks for easy comparison.
  const seriesActiveKeys = seriesDisplay === 'combined' && resolvedSeries.length >= 2
    ? ['__combined']
    : resolvedSeries.map(s => s.key)
  const seriesYAxis: { domain: ['auto', 'auto'] | [number, number]; ticks: number[] | undefined } = (() => {
    if (!seriesChartData.length || !seriesActiveKeys.length) return { domain: ['auto', 'auto'], ticks: undefined }
    const vals = seriesChartData.flatMap(row => seriesActiveKeys.map(k => row[k] as number))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
    const { domain, ticks } = niceTicks(min - pad, max + pad)
    return { domain, ticks }
  })()

  const isSeriesSelected = (ref: SeriesRef) => selectedSeries.some(r => seriesKey(r) === seriesKey(ref))
  const toggleSeries = (ref: SeriesRef) => setSelectedSeries(prev =>
    prev.some(r => seriesKey(r) === seriesKey(ref))
      ? prev.filter(r => seriesKey(r) !== seriesKey(ref))
      : [...prev, ref]
  )

  const hasEquityPairs = (equityHistory?.pairs?.length ?? 0) > 0
  const nwModeOptions: { value: 'net-worth' | 'equity' | 'series'; label: string }[] = [
    { value: 'net-worth', label: 'Net Worth' },
    ...(hasEquityPairs ? [{ value: 'equity' as const, label: 'Equity' }] : []),
    { value: 'series' as const, label: 'Accounts & Groups' },
  ]
  const headlineValue: number | null =
    nwMode === 'net-worth' ? (nwHistory?.current_net_worth ?? null)
      : nwMode === 'equity' ? (selectedEquityPair?.current_equity ?? null)
        : (seriesCombined.length ? seriesCombined[seriesCombined.length - 1] : null)

  // Spending tab: build per-category averages from 12-month trend data (anchored to last complete month)
  const spendingExpenseSeries = spendingTrends?.series.filter(s => !s.is_income) ?? []
  const spendingAvgMap = new Map<string, { avg3: number; avg6: number; avg12: number }>()
  for (const s of spendingExpenseSeries) {
    const t = s.monthly_totals
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    spendingAvgMap.set(s.category_name, {
      avg3: avg(t.slice(-Math.min(3, t.length))),
      avg6: avg(t.slice(-Math.min(6, t.length))),
      avg12: avg(t.slice(-Math.min(12, t.length))),
    })
  }

  // Spending tab: merge budget lines with trend averages, grouped by parent
  const spendingRows = (() => {
    if (!budgetReport) return []
    const groups = new Map<string, { actual: number; budgeted: number; avg3: number; avg6: number; avg12: number; children: { name: string; actual: number; budgeted: number; pctUsed: number | null; avg3: number; avg6: number; avg12: number }[] }>()
    for (const line of budgetReport.expense_lines) {
      const parent = line.parent_category_name ?? 'Other'
      if (!groups.has(parent)) groups.set(parent, { actual: 0, budgeted: 0, avg3: 0, avg6: 0, avg12: 0, children: [] })
      const g = groups.get(parent)!
      const avgs = spendingAvgMap.get(line.category_name) ?? { avg3: 0, avg6: 0, avg12: 0 }
      g.actual += line.actual
      g.budgeted += line.budgeted
      g.avg3 += avgs.avg3
      g.avg6 += avgs.avg6
      g.avg12 += avgs.avg12
      g.children.push({
        name: line.category_name,
        actual: line.actual,
        budgeted: line.budgeted,
        pctUsed: line.percent_used ?? null,
        avg3: avgs.avg3,
        avg6: avgs.avg6,
        avg12: avgs.avg12,
      })
    }
    return Array.from(groups.entries())
      .map(([parent, g]) => ({
        parent,
        ...g,
        children: [...g.children].sort((a, b) => b.actual - a.actual),
        pctUsed: g.budgeted > 0 ? (g.actual / g.budgeted) * 100 : null,
      }))
      .sort((a, b) => b.actual - a.actual)
  })()

  // Pie chart data — shows parent group totals when collapsed, individual categories when expanded
  const pieData = (() => {
    if (!spendingRows.length) return []
    const items: { name: string; value: number }[] = []
    for (const group of spendingRows) {
      if (isGroupCollapsed(group.parent)) {
        if (group.actual > 0) items.push({ name: group.parent, value: group.actual })
      } else {
        for (const child of group.children) {
          if (child.actual > 0) items.push({ name: child.name, value: child.actual })
        }
      }
    }
    return items
      .sort((a, b) => b.value - a.value)
      .map((item, i) => ({ ...item, color: CHART_COLORS[i % CHART_COLORS.length] }))
  })()

  const pieColorMap = new Map(pieData.map(d => [d.name, d.color]))

  const liquidAssets = (accounts ?? []).filter(a =>
    !a.is_liability &&
    a.is_liquid &&
    a.is_active &&
    a.include_in_net_worth
  )
  const liquidAssetsTotal = liquidAssets.reduce((sum, a) => sum + (a.current_balance ?? 0), 0)
  const cashLiquidTypes = new Set(['checking', 'savings', 'hysa', 'cash'])
  const cashLiquidTotal = liquidAssets
    .filter(a => cashLiquidTypes.has(a.account_type))
    .reduce((sum, a) => sum + (a.current_balance ?? 0), 0)
  const investedLiquidTotal = liquidAssetsTotal - cashLiquidTotal
  const emergencyFundBase = includeAllLiquidAssets ? liquidAssetsTotal : Math.max(0, liquidAssetsTotal - investedLiquidTotal)

  const emergencyExpenseSeries = emergencyTrends?.series.filter(s => !s.is_income) ?? []
  const emergencySeries = emergencyExpenseSeries.map(s => ({
    key: s.category_id != null ? `id:${s.category_id}` : `name:${s.category_name}`,
    name: s.category_name,
    monthly: s.monthly_totals,
    total: s.total,
  }))
  const emergencyMonthCount = emergencyTrends?.months.length ?? 0
  const emergencyBaselineMonthly = emergencyTrends?.monthly_expense_totals ?? []

  const emergencyMonthlyIncluded = Array.from({ length: emergencyMonthCount }, (_, idx) => {
    const excludedPortion = emergencySeries.reduce((sum, s) =>
      excludedEmergencyCategories.has(s.key) ? sum + (s.monthly[idx] ?? 0) : sum, 0
    )
    return Math.max(0, (emergencyBaselineMonthly[idx] ?? 0) - excludedPortion)
  })

  const averageExpense = (months: number) => {
    if (emergencyMonthlyIncluded.length === 0) return 0
    const slice = emergencyMonthlyIncluded.slice(-Math.min(months, emergencyMonthlyIncluded.length))
    if (slice.length === 0) return 0
    return slice.reduce((sum, v) => sum + v, 0) / slice.length
  }

  const avg3 = averageExpense(3)
  const avg6 = averageExpense(6)
  const avg12 = averageExpense(12)

  const coverageMonths = (avg: number) => avg > 0 ? emergencyFundBase / avg : null
  const coverage3 = coverageMonths(avg3)
  const coverage6 = coverageMonths(avg6)
  const coverage12 = coverageMonths(avg12)

  const minVal = emergencyTargetMinMonths === '' ? 0 : emergencyTargetMinMonths
  const maxVal = emergencyTargetMaxMonths === '' ? 0 : emergencyTargetMaxMonths
  const targetMinMonths = Math.max(0, Math.min(minVal, maxVal))
  const targetMaxMonths = Math.max(targetMinMonths, Math.max(minVal, maxVal))

  const fundingRange = (avg: number) => {
    if (avg <= 0) return null
    const minTarget = avg * targetMinMonths
    const maxTarget = avg * targetMaxMonths
    if (emergencyFundBase < minTarget) {
      return {
        minTarget,
        maxTarget,
        status: 'under' as const,
        delta: minTarget - emergencyFundBase,
      }
    }
    if (emergencyFundBase > maxTarget) {
      return {
        minTarget,
        maxTarget,
        status: 'over' as const,
        delta: emergencyFundBase - maxTarget,
      }
    }
    return {
      minTarget,
      maxTarget,
      status: 'within' as const,
      delta: 0,
    }
  }

  const toggleEmergencyCategory = (key: string) => {
    setExcludedEmergencyCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const REPORT_TITLES: Record<ReportTab, { title: string; subtitle: string }> = {
    'net-worth': { title: 'Net Worth & Equity', subtitle: '' },
    'cash-flow': { title: 'Cash Flow', subtitle: '' },
    'spending': { title: 'Spending', subtitle: '' },
    'emergency-fund': { title: 'Emergency Fund', subtitle: '' },
  }

  const { title, subtitle } = REPORT_TITLES[activeTab] ?? REPORT_TITLES['net-worth']

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title={title}
        subtitle={subtitle}
      />

      {/* Spending Report */}
      {activeTab === 'spending' && (
        <div className="space-y-4">
          {/* Header with month/year selector */}
          <Card padding={false}>
            <div className="flex items-center justify-between p-5">
              <div></div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setShowAllCategories(v => !v)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    showAllCategories
                      ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                      : 'bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200'
                  )}
                >
                  All
                </button>
                <button
                  onClick={() => setShowDiff(d => !d)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    showDiff
                      ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                      : 'bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200'
                  )}
                >
                  +/-
                </button>
                <select
                  value={`${spendingYear}-${spendingMonth}`}
                  onChange={e => {
                    const [y, m] = e.target.value.split('-').map(Number)
                    setSpendingYear(y)
                    setSpendingMonth(m)
                  }}
                  className="bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-ink-100 focus:outline-none"
                >
                  {Array.from({ length: 5 }, (_, i) => now.year - 4 + i)
                  .reverse()
                  .map(y => {
                    const months = Array.from({ length: 12 }, (_, m) => m + 1)
                      .filter(m => y < now.year || m <= now.month)
                      .reverse()
                    if (months.length === 0) return null
                    return (
                      <optgroup key={y} label={String(y)}>
                        {months.map(m => (
                          <option key={`${y}-${m}`} value={`${y}-${m}`}>
                            {`${y} - ${new Date(y, m - 1).toLocaleString('default', { month: 'long' })}`}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
            </div>
          </Card>

          {(spendingTrendsLoading || budgetLoading) ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : (
            <>
              {isCurrentMonth && (
                <div className="text-sm text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-lg px-4 py-2.5 flex items-center gap-2">
                  <span className="text-amber-400 text-base">⚠</span>
                  Averages are based on previous months — current month is still in progress
                </div>
              )}
              <Card padding={false}>
                <div className="flex flex-col md:flex-row">
                  {/* Pie chart */}
                  {pieData.length > 0 && (
                    <div className="p-5 border-b md:border-b-0 md:border-r border-white/[0.06] flex-shrink-0 flex justify-center md:block">
                      <ResponsiveContainer width={200} height={200}>
                        <PieChart>
                          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2}>
                            {pieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                          </Pie>
                          <Tooltip
                            contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12, color: '#e8e6e3' }}
                            itemStyle={{ color: '#e8e6e3' }}
                            formatter={(v: number, name: string) => [formatCurrencyWhole(v), name]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Floating table header — appears when real header scrolls behind PageHeader */}
                  {showFloatingHeader && (() => {
                    const rect = tableWrapperRef.current?.getBoundingClientRect()
                    return (
                      <div
                        className="fixed z-20 bg-surface-800 border-b border-white/[0.06] shadow-lg"
                        style={{
                          top: 'var(--page-header-height, 0px)',
                          left: rect?.left ?? 0,
                          width: rect?.width ?? '100%',
                        }}
                      >
                        <div
                          ref={floatingHeaderRef}
                          className="overflow-hidden"
                        >
                          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth }}>
                            <colgroup>
                              <col style={{ width: catColWidth }} />
                              <col style={{ width: '100px' }} />
                              <col style={{ width: '140px' }} />
                              <col style={{ width: '90px' }} />
                              <col style={{ width: '90px' }} />
                              <col style={{ width: '90px' }} />
                            </colgroup>
                            <thead>
                              <tr>
                                <th className="text-left text-ink-300 text-xs font-medium py-3 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                                <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">This Month</th>
                                <th className="text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs Budget' : 'Budget'}</th>
                                <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 3M' : '3M Avg'}</th>
                                <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 6M' : '6M Avg'}</th>
                                <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 12M' : '12M Avg'}</th>
                              </tr>
                            </thead>
                          </table>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Category table */}
                  <div className="flex-1 overflow-x-auto" ref={tableWrapperRef} onScroll={onTableScroll}>
                    <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth }}>
                      <colgroup>
                        <col style={{ width: catColWidth }} />
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '140px' }} />
                        <col style={{ width: '90px' }} />
                        <col style={{ width: '90px' }} />
                        <col style={{ width: '90px' }} />
                      </colgroup>
                      <thead ref={theadRef}>
                        <tr className="border-b border-white/[0.06]">
                          <th className="text-left text-ink-300 text-xs font-medium py-3 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                          <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">This Month</th>
                          <th className="text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs Budget' : 'Budget'}</th>
                          <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 3M' : '3M Avg'}</th>
                          <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 6M' : '6M Avg'}</th>
                          <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 12M' : '12M Avg'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Totals row */}
                        {budgetReport && (() => {
                          const totalPct = budgetReport.total_expenses_budgeted > 0
                            ? (budgetReport.total_expenses_actual / budgetReport.total_expenses_budgeted) * 100
                            : null
                          return (
                            <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                              <td className="py-3 font-medium text-ink-100 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Total Expenses</td>
                              <td className="px-4 py-3 text-right font-mono text-ink-100">{formatCurrencyWhole(budgetReport.total_expenses_actual)}</td>
                              <td className="px-4 py-3">
                                {budgetReport.total_expenses_budgeted > 0 ? (
                                  <div className="flex items-center gap-2">
                                    <BudgetProgress pct={totalPct ?? 0} />
                                    {showDiff ? (() => {
                                      const diff = budgetReport.total_expenses_actual - budgetReport.total_expenses_budgeted
                                      return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                    })() : (
                                      <span className="font-mono text-ink-200 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(budgetReport.total_expenses_budgeted)}</span>
                                    )}
                                  </div>
                                ) : <span className="text-ink-500">—</span>}
                              </td>
                              {(() => {
                                const met = spendingTrends?.monthly_expense_totals ?? []
                                const avgSlice = (n: number) => { const s = met.slice(-Math.min(n, met.length)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0 }
                                const totalAvg3 = avgSlice(3)
                                const totalAvg6 = avgSlice(6)
                                const totalAvg12 = avgSlice(12)
                                const actual = budgetReport.total_expenses_actual
                                const fmtCell = (avg: number) => {
                                  if (!showDiff) return formatCurrencyWhole(avg)
                                  if (avg <= 0) return '—'
                                  return formatCurrencySignedWhole(actual - avg)
                                }
                                const diffClass = (avg: number) => {
                                  if (!showDiff || avg <= 0) return 'text-ink-200'
                                  return actual - avg > 0 ? 'text-red-400' : 'text-emerald-400'
                                }
                                return [
                                  ['avg3', totalAvg3],
                                  ['avg6', totalAvg6],
                                  ['avg12', totalAvg12],
                                ].map(([key, avg]) => (
                                  <td key={key as string} className={clsx('px-4 py-3 text-right font-mono text-xs', diffClass(avg as number))}>{fmtCell(avg as number)}</td>
                                ))
                              })()}
                            </tr>
                          )
                        })()}

                        {spendingRows.filter(group => showAllCategories || group.actual > 0).map(group => {
                          const groupExpanded = !isGroupCollapsed(group.parent)
                          const visibleChildren = group.children.filter(child => showAllCategories || child.actual > 0)
                          return (
                          <>
                            {/* Parent group header */}
                            <tr
                              key={`group-${group.parent}`}
                              className="group bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] transition-colors border-t border-white/[0.12]"
                              onClick={() => setCollapsedGroups(prev => {
                                if (prev === 'all') {
                                  // Expand just this group: create set of all groups except this one
                                  const allNames = spendingRows.map(g => g.parent)
                                  const next = new Set(allNames)
                                  next.delete(group.parent)
                                  return next
                                }
                                const next = new Set(prev)
                                if (next.has(group.parent)) next.delete(group.parent)
                                else next.add(group.parent)
                                return next
                              })}
                            >
                              <td className="py-2.5 font-medium text-ink-100 sticky left-0 z-10 bg-surface-800 group-hover:bg-surface-700 transition-colors" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>
                                <span className="inline-block overflow-hidden text-ink-400 text-xs" style={{ width: catArrowWidth, marginRight: catArrowMargin }}>
                                  {isGroupCollapsed(group.parent) ? '▸' : '▾'}
                                </span>
                                {pieColorMap.has(group.parent) && (
                                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: pieColorMap.get(group.parent) }} />
                                )}
                                {group.parent}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-ink-100">{groupExpanded ? null : formatCurrencyWhole(group.actual)}</td>
                              <td className="px-4 py-2.5">
                                {groupExpanded ? null : (group.budgeted > 0 ? (
                                  <div className="flex items-center gap-2">
                                    <BudgetProgress pct={group.pctUsed ?? 0} />
                                    {showDiff ? (() => {
                                      const diff = group.actual - group.budgeted
                                      return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                    })() : (
                                      <span className="font-mono text-ink-200 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(group.budgeted)}</span>
                                    )}
                                  </div>
                                ) : <span className="text-ink-500">—</span>)}
                              </td>
                              <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg3 > 0 ? (showDiff ? (group.actual - group.avg3 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg3 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                                {groupExpanded ? null : (group.avg3 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg3) : formatCurrencyWhole(group.avg3)) : '—')}
                              </td>
                              <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg6 > 0 ? (showDiff ? (group.actual - group.avg6 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg6 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                                {groupExpanded ? null : (group.avg6 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg6) : formatCurrencyWhole(group.avg6)) : '—')}
                              </td>
                              <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg12 > 0 ? (showDiff ? (group.actual - group.avg12 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg12 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                                {groupExpanded ? null : (group.avg12 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg12) : formatCurrencyWhole(group.avg12)) : '—')}
                              </td>
                            </tr>

                            {/* Child category rows */}
                            {groupExpanded && visibleChildren.map((child) => (
                              <tr key={`child-${child.name}`} className="border-t border-white/[0.03]">
                                <td className="py-2 text-ink-300 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catChildPadLeft, paddingRight: catBasePad }}>
                                  {pieColorMap.has(child.name) && (
                                    <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: pieColorMap.get(child.name) }} />
                                  )}
                                  {child.name}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-ink-200">{formatCurrencyWhole(child.actual)}</td>
                                <td className="px-4 py-2">
                                  {child.budgeted > 0 ? (
                                    <div className="flex items-center gap-2">
                                      <BudgetProgress pct={child.pctUsed ?? 0} />
                                      {showDiff ? (() => {
                                        const diff = child.actual - child.budgeted
                                        return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                      })() : (
                                        <span className="font-mono text-ink-300 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(child.budgeted)}</span>
                                      )}
                                    </div>
                                  ) : <span className="text-ink-500">—</span>}
                                </td>
                                <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg3 > 0 ? (showDiff ? (child.actual - child.avg3 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg3 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                                  {child.avg3 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg3) : formatCurrencyWhole(child.avg3)) : '—'}
                                </td>
                                <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg6 > 0 ? (showDiff ? (child.actual - child.avg6 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg6 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                                  {child.avg6 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg6) : formatCurrencyWhole(child.avg6)) : '—'}
                                </td>
                                <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg12 > 0 ? (showDiff ? (child.actual - child.avg12 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg12 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                                  {child.avg12 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg12) : formatCurrencyWhole(child.avg12)) : '—'}
                                </td>
                              </tr>
                            ))}
                          </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Net Worth History */}
      {activeTab === 'net-worth' && (
        <div className="space-y-4">
          {/* Header card with view selector, time filter, and change stats */}
          <Card padding={false}>
            <div className="p-5 pb-3 space-y-2 md:space-y-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Mode selector: Net Worth / Equity / Accounts & Groups */}
                  <div className="flex rounded-lg bg-surface-700 border border-white/[0.08] p-0.5">
                    {nwModeOptions.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setNwMode(m.value)}
                        className={clsx(
                          'px-3 py-1 rounded-md text-sm font-semibold transition-colors whitespace-nowrap',
                          nwMode === m.value ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {/* Equity pair picker */}
                  {nwMode === 'equity' && (
                    <select
                      value={effectiveEquityId ?? ''}
                      onChange={e => setEquityAssetId(Number(e.target.value))}
                      className="bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-100 focus:outline-none focus:border-amber-400/40"
                    >
                      {(equityHistory?.pairs ?? []).map(p => (
                        <option key={p.asset_id} value={p.asset_id}>{p.asset_name}</option>
                      ))}
                    </select>
                  )}
                  {/* Accounts & groups tiered multi-select picker */}
                  {nwMode === 'series' && (
                    <>
                      <FilterDropdown
                        disabled={!activeAccounts.length}
                        isActive={selectedSeries.length > 0}
                        buttonLabel={
                          selectedSeries.length === 0 ? 'Select accounts or groups'
                            : selectedSeries.length === 1 ? seriesLabel(selectedSeries[0])
                              : `${selectedSeries.length} selected`
                        }
                      >
                        {(['liquid', 'assets', 'liabilities'] as const).map(f => {
                          const ref: SeriesRef = { kind: 'filter', filter: f }
                          return (
                            <CheckboxRow
                              key={f}
                              checked={isSeriesSelected(ref)}
                              label={FILTER_LABELS[f]}
                              bold
                              onToggle={() => toggleSeries(ref)}
                            />
                          )
                        })}
                        <div className="h-px bg-white/[0.06] my-1" />
                        {presentTypes.map(t => {
                          const groupRef: SeriesRef = { kind: 'group', accountType: t }
                          const groupSelected = isSeriesSelected(groupRef)
                          const typeAccounts = activeAccounts.filter(a => a.account_type === t)
                          const selectedChildCount = typeAccounts.filter(a => isSeriesSelected({ kind: 'account', id: a.id })).length

                          return (
                            <div key={t} className="py-1">
                              <CheckboxRow
                                checked={groupSelected}
                                indeterminate={!groupSelected && selectedChildCount > 0}
                                label={`All ${formatAccountType(t)}`}
                                sublabel={selectedChildCount > 0 ? `${selectedChildCount}/${typeAccounts.length} accounts selected` : undefined}
                                bold
                                onToggle={() => toggleSeries(groupRef)}
                              />
                              <div className="pl-6">
                                {typeAccounts.map(a => {
                                  const accountRef: SeriesRef = { kind: 'account', id: a.id }
                                  return (
                                    <CheckboxRow
                                      key={a.id}
                                      checked={isSeriesSelected(accountRef)}
                                      label={a.name}
                                      onToggle={() => toggleSeries(accountRef)}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </FilterDropdown>
                      {selectedSeries.length >= 2 && (
                        <div className="flex rounded-lg bg-surface-700 border border-white/[0.08] p-0.5">
                          {(['compare', 'combined'] as const).map(mode => (
                            <button
                              key={mode}
                              onClick={() => setSeriesDisplay(mode)}
                              className={clsx(
                                'px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors',
                                seriesDisplay === mode ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                              )}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {/* Value shown inline on desktop only */}
                  <span className={`hidden md:inline font-mono text-lg ${
                    (headlineValue ?? 0) >= 0 ? 'text-teal-400' : 'text-red-400'
                  }`}>
                    {formatCurrencyWhole(headlineValue)}
                  </span>
                </div>
                <div className="flex gap-1">
                  {NW_OPTIONS.map(o => (
                    <button
                      key={o.months}
                      onClick={() => setNwMonths(o.months)}
                      className={clsx(
                        'px-2.5 py-1 rounded text-xs font-mono transition-colors',
                        nwMonths === o.months ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Value shown below selector on mobile only */}
              <span className={`block md:hidden font-mono text-lg ${
                (headlineValue ?? 0) >= 0 ? 'text-teal-400' : 'text-red-400'
              }`}>
                {formatCurrencyWhole(headlineValue)}
              </span>
            </div>

            {/* Change stats */}
            {(() => {
              const loading = nwMode === 'equity' ? equityLoading : nwLoading
              let change1m: number | null | undefined
              let change3m: number | null | undefined
              let changePeriod: number | null | undefined

              // Compute deltas from a numeric series anchored to the last complete month
              const changesFrom = (vals: number[]) => {
                const n = vals.length
                const lastIdx = n - 1
                const lastVal = vals[lastIdx]
                return {
                  c1m: lastIdx >= 1 ? Math.round((lastVal - vals[lastIdx - 1]) * 100) / 100 : null,
                  c3m: Math.round((lastVal - vals[Math.max(0, lastIdx - 3)]) * 100) / 100,
                  cPeriod: Math.round((lastVal - vals[0]) * 100) / 100,
                }
              }

              if (nwMode === 'net-worth') {
                change1m = nwHistory?.change_1m
                change3m = nwHistory?.change_3m
                changePeriod = nwHistory?.change_period
              } else if (nwMode === 'equity' && selectedEquityPair && equityChartData.length >= 2) {
                const c = changesFrom(equityChartData.map(p => p.equity))
                change1m = c.c1m; change3m = c.c3m; changePeriod = c.cPeriod
              } else if (nwMode === 'series' && seriesCombined.length >= 2) {
                const c = changesFrom(seriesCombined)
                change1m = c.c1m; change3m = c.c3m; changePeriod = c.cPeriod
              }

              const stats = [
                { label: '1 Month Change', value: change1m },
                { label: '3 Month Change', value: change3m },
                { label: NW_OPTIONS.find(o => o.months === nwMonths)?.changeLabel ?? 'Period Change', value: changePeriod },
              ]

              return (
                <div className="grid grid-cols-3 gap-px bg-white/[0.04] border-t border-white/[0.06]">
                  {stats.map(s => (
                    <div key={s.label} className="bg-surface-800 px-5 py-3">
                      <div className="label mb-1">{s.label}</div>
                      {loading ? (
                        <div className="h-6 w-24 bg-surface-700 rounded animate-pulse" />
                      ) : (
                        <div className={clsx(
                          'font-mono text-lg',
                          s.value == null ? 'text-ink-400'
                            : s.value >= 0 ? 'text-teal-400' : 'text-rose-400'
                        )}>
                          {s.value != null ? formatCurrencySignedWhole(s.value) : '—'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
          </Card>

          {/* Chart */}
          {(nwMode === 'equity' ? equityLoading : nwLoading) ? (
            <Card>
              <div className="flex justify-center py-16"><Spinner size="lg" /></div>
            </Card>
          ) : nwMode === 'net-worth' && nwData.length === 0 ? (
            <Card>
              <div className="py-16 text-center text-ink-400 text-sm">
                No balance history yet — update account balances to see trends
              </div>
            </Card>
          ) : nwMode === 'equity' && equityChartData.length === 0 ? (
            <Card>
              <div className="py-16 text-center text-ink-400 text-sm">
                No equity history yet — update asset and liability balances to see trends
              </div>
            </Card>
          ) : nwMode === 'series' && selectedSeries.length === 0 ? (
            <Card>
              <div className="py-16 text-center text-ink-400 text-sm">
                Pick one or more accounts or groups above to chart their balances over time
              </div>
            </Card>
          ) : nwMode === 'series' && seriesChartData.length === 0 ? (
            <Card>
              <div className="py-16 text-center text-ink-400 text-sm">
                No balance history yet for this selection — update account balances to see trends
              </div>
            </Card>
          ) : nwMode === 'net-worth' ? (
            <Card padding={false}>
              <div className="p-5 pb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                {[
                  { label: 'Net Worth', color: 'bg-amber-400', textColor: 'text-amber-400', value: nwData[nwData.length - 1]?.net ?? 0 },
                  { label: 'Assets', color: 'bg-teal-400', textColor: 'text-teal-400', value: nwData[nwData.length - 1]?.assets ?? 0 },
                  { label: 'Liabilities', color: 'bg-rose-400', textColor: 'text-rose-400', value: nwData[nwData.length - 1]?.liabilities ?? 0 },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={clsx('w-2.5 h-2.5 rounded-full', item.color)} />
                    <span className="text-xs text-ink-300">{item.label}</span>
                    <span className={clsx('font-mono text-sm', item.textColor)}>{formatCurrencyWhole(item.value)}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={nwData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="netGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f5a623" stopOpacity={0.15}/>
                        <stop offset="100%" stopColor="#f5a623" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="assetsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d4b1" stopOpacity={0.1}/>
                        <stop offset="100%" stopColor="#34d4b1" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="liabGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.1}/>
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                    <YAxis
                      yAxisId="net"
                      orientation="left"
                      domain={nwSyncedDomain.net}
                      ticks={nwSyncedDomain.netTicks}
                      tick={{ fill: '#f5a623', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="assets"
                      orientation="right"
                      domain={nwSyncedDomain.assets}
                      ticks={nwSyncedDomain.assetTicks}
                      tick={{ fill: '#34d4b1', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="liabilities"
                      orientation="right"
                      domain={nwSyncedDomain.liabs}
                      ticks={nwSyncedDomain.liabTicks}
                      tick={{ fill: '#f87171', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      mirror
                    />
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <Tooltip
                      contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                      labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                      formatter={(v: number, name: string) => {
                        const labels: Record<string, string> = { assets: 'Assets', liabilities: 'Liabilities', net: 'Net Worth' }
                        return [formatCurrencyWhole(v), labels[name] ?? name]
                      }}
                    />
                    <Area type="monotone" dataKey="assets" yAxisId="assets" stroke="#34d4b1" strokeWidth={1.5} fill="url(#assetsGrad)" dot={false} />
                    <Area type="monotone" dataKey="liabilities" yAxisId="liabilities" stroke="#f87171" strokeWidth={1.5} fill="url(#liabGrad)" dot={false} />
                    <Area type="monotone" dataKey="net" yAxisId="net" stroke="#f5a623" strokeWidth={2} fill="url(#netGrad2)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : nwMode === 'equity' ? (
            /* Equity pair chart */
            <Card padding={false}>
              <div className="p-5 pb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                {[
                  { label: 'Equity', color: 'bg-amber-400', textColor: 'text-amber-400', value: equityChartData[equityChartData.length - 1]?.equity ?? 0 },
                  { label: 'Asset Value', color: 'bg-teal-400', textColor: 'text-teal-400', value: equityChartData[equityChartData.length - 1]?.asset ?? 0 },
                  { label: 'Liability', color: 'bg-rose-400', textColor: 'text-rose-400', value: equityChartData[equityChartData.length - 1]?.liability ?? 0 },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={clsx('w-2.5 h-2.5 rounded-full', item.color)} />
                    <span className="text-xs text-ink-300">{item.label}</span>
                    <span className={clsx('font-mono text-sm', item.textColor)}>{formatCurrencyWhole(item.value)}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={equityChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f5a623" stopOpacity={0.15}/>
                        <stop offset="100%" stopColor="#f5a623" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="eqAssetGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d4b1" stopOpacity={0.1}/>
                        <stop offset="100%" stopColor="#34d4b1" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="eqLiabGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.1}/>
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                    <YAxis
                      yAxisId="equity"
                      orientation="left"
                      domain={eqSyncedDomain.equity}
                      ticks={eqSyncedDomain.equityTicks}
                      tick={{ fill: '#f5a623', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="asset"
                      orientation="right"
                      domain={eqSyncedDomain.asset}
                      ticks={eqSyncedDomain.assetTicks}
                      tick={{ fill: '#34d4b1', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis
                      yAxisId="liability"
                      orientation="right"
                      domain={eqSyncedDomain.liability}
                      ticks={eqSyncedDomain.liabilityTicks}
                      tick={{ fill: '#f87171', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      mirror
                    />
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <Tooltip
                      contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                      labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                      formatter={(v: number, name: string) => {
                        const labels: Record<string, string> = { asset: 'Asset Value', liability: 'Liability', equity: 'Equity' }
                        return [formatCurrencyWhole(v), labels[name] ?? name]
                      }}
                    />
                    <Area type="monotone" dataKey="asset" yAxisId="asset" stroke="#34d4b1" strokeWidth={1.5} fill="url(#eqAssetGrad)" dot={false} />
                    <Area type="monotone" dataKey="liability" yAxisId="liability" stroke="#f87171" strokeWidth={1.5} fill="url(#eqLiabGrad)" dot={false} />
                    <Area type="monotone" dataKey="equity" yAxisId="equity" stroke="#f5a623" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : (
            /* Accounts & Groups chart */
            <Card padding={false}>
              <div className="p-5 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {seriesDisplay === 'combined' && resolvedSeries.length >= 2 && (
                  <div className="flex items-center gap-2 pr-4 border-r border-white/[0.08]">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[0] }} />
                    <span className="text-xs text-ink-300">Combined Total</span>
                    <span className="font-mono text-sm text-amber-400">{formatCurrencyWhole(seriesCombined[seriesCombined.length - 1] ?? 0)}</span>
                  </div>
                )}
                {resolvedSeries.map(s => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-xs text-ink-300">{s.label}</span>
                    <span className="font-mono text-sm" style={{ color: s.color }}>
                      {formatCurrencyWhole((seriesChartData[seriesChartData.length - 1]?.[s.key] as number) ?? 0)}
                    </span>
                    <button
                      onClick={() => toggleSeries(s.ref)}
                      className="text-ink-400 hover:text-rose-400 px-0.5 leading-none transition-colors"
                      aria-label={`Remove ${s.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={seriesChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                    <YAxis
                      domain={seriesYAxis.domain}
                      ticks={seriesYAxis.ticks}
                      tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                      width={52}
                    />
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" />
                    <Tooltip
                      contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                      labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                      formatter={(v: number, name: string) => {
                        const label = name === '__combined' ? 'Combined Total' : (resolvedSeries.find(s => s.key === name)?.label ?? name)
                        return [formatCurrencyWhole(v), label]
                      }}
                    />
                    {seriesDisplay === 'combined' && resolvedSeries.length >= 2 ? (
                      <Area type="monotone" dataKey="__combined" stroke={CHART_COLORS[0]} strokeWidth={2} fill={CHART_COLORS[0]} fillOpacity={0.08} dot={false} />
                    ) : (
                      resolvedSeries.map(s => (
                        <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.06} dot={false} />
                      ))
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Cash Flow Detail */}
      {activeTab === 'cash-flow' && (() => {
        // Build per-category series with keys for exclusion
        const cfSeries = (cfTrends?.series ?? []).map(s => ({
          key: s.category_id != null ? `id:${s.category_id}` : `name:${s.category_name}`,
          name: s.category_name,
          isIncome: s.is_income,
          monthly: s.monthly_totals,
          total: s.total,
        }))

        const rawMonthCount = cfTrends?.months.length ?? 0
        const rawCfLabels = cfTrends?.month_labels ?? []

        // Compute adjusted monthly totals by subtracting excluded categories
        const adjustedIncomeByMonth = Array.from({ length: rawMonthCount }, (_, idx) => {
          const base = cfTrends?.monthly_income_totals[idx] ?? 0
          const excluded = cfSeries.reduce((sum, s) =>
            s.isIncome && excludedCfCategories.has(s.key) ? sum + (s.monthly[idx] ?? 0) : sum, 0)
          return Math.max(0, base - excluded)
        })
        const adjustedExpenseByMonth = Array.from({ length: rawMonthCount }, (_, idx) => {
          const base = cfTrends?.monthly_expense_totals[idx] ?? 0
          const excluded = cfSeries.reduce((sum, s) =>
            !s.isIncome && excludedCfCategories.has(s.key) ? sum + (s.monthly[idx] ?? 0) : sum, 0)
          return Math.max(0, base - excluded)
        })

        // In custom/long-range views, trim months with no activity to avoid long empty runs.
        const monthIdxsAll = Array.from({ length: rawMonthCount }, (_, i) => i)
        const includedMonthIdxs = ((cfRangeMode === 'preset' && cfMonths >= 60) || cfRangeMode === 'custom')
          ? monthIdxsAll.filter(i =>
              Math.abs(adjustedIncomeByMonth[i] ?? 0) > 0.000001 || Math.abs(adjustedExpenseByMonth[i] ?? 0) > 0.000001
            )
          : monthIdxsAll

        const monthCount = includedMonthIdxs.length
        const cfLabels = includedMonthIdxs.map(i => rawCfLabels[i] ?? '')
        const cfIncomes = includedMonthIdxs.map(i => adjustedIncomeByMonth[i] ?? 0)
        const cfExpenses = includedMonthIdxs.map(i => adjustedExpenseByMonth[i] ?? 0)

        const totalIncome = cfIncomes.reduce((a: number, b: number) => a + b, 0)
        const totalExpenses = cfExpenses.reduce((a: number, b: number) => a + b, 0)
        const totalNet = totalIncome - totalExpenses

        const avgIncome = monthCount > 0 ? totalIncome / monthCount : 0
        const avgExpenses = monthCount > 0 ? totalExpenses / monthCount : 0
        const avgNet = monthCount > 0 ? totalNet / monthCount : 0

        const barSize = monthCount <= 12 ? 28 : monthCount <= 24 ? 18 : monthCount <= 36 ? 12 : 8

        const chartData = cfLabels.map((label: string, i: number) => ({
          label,
          income: Math.round(cfIncomes[i] * 100) / 100,
          expense: -Math.round(cfExpenses[i] * 100) / 100,
          net: Math.round((cfIncomes[i] - cfExpenses[i]) * 100) / 100,
        }))

        const incomeSeries = cfSeries.filter(s => s.isIncome).sort((a, b) => b.total - a.total)
        const expenseSeries = cfSeries.filter(s => !s.isIncome).sort((a, b) => b.total - a.total)

        const toggleCfCategory = (key: string) => {
          setExcludedCfCategories(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }

        const applyCustomCfRange = (startValue = cfCustomStart, endValue = cfCustomEnd) => {
          const start = parseYearMonthInput(startValue)
          const end = parseYearMonthInput(endValue)
          if (!start || !end) {
            setCfCustomError('Select a start and end month.')
            return
          }
          if (compareYearMonth(end, now) > 0) {
            setCfCustomError(`End month must be ${yearMonthToInput(now)} or earlier.`)
            return
          }
          if (compareYearMonth(start, end) > 0) {
            setCfCustomError('Start month must be before or equal to end month.')
            return
          }
          const months = diffMonths(start, end) + 1
          if (months < 1) {
            setCfCustomError('Invalid range.')
            return
          }
          if (months > 120) {
            setCfCustomError('Range too long (max 120 months).')
            return
          }
          setCfCustomError(null)
          setCfRangeMode('custom')
          setCfMonths(months)
          setCfAnchor(end)
        }

        return (
          <div className="space-y-4">
          <Card>
            <div className="flex flex-col items-end gap-3 mb-5">
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                {(() => {
                  const startYm = cfRangeMode === 'preset'
                    ? addMonths(cfAnchor, -(Math.max(1, cfMonths) - 1))
                    : parseYearMonthInput(cfCustomStart)
                  const endYm = cfRangeMode === 'preset'
                    ? cfAnchor
                    : parseYearMonthInput(cfCustomEnd)

                  if (!startYm || !endYm || cfCustomError) return null

                  const from = `${startYm.year}-${String(startYm.month).padStart(2, '0')}-01`
                  const endDay = new Date(endYm.year, endYm.month, 0).getDate()
                  const to = `${endYm.year}-${String(endYm.month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

                  const sp = new URLSearchParams()
                  sp.set('from', from)
                  sp.set('to', to)
                  if (excludedCfCategories.size > 0) sp.set('exclude_cf', Array.from(excludedCfCategories).join(','))

                  return (
                    <Link
                      to={`/transactions?${sp.toString()}`}
                      className="px-3 py-1.5 text-xs font-medium bg-surface-800 border border-white/[0.06] text-ink-200 rounded-lg hover:bg-surface-700 transition-colors"
                    >
                      View transactions
                      {excludedCfCategories.size > 0 && (
                        <span className="text-ink-500 ml-1">(excluding {excludedCfCategories.size})</span>
                      )}
                    </Link>
                  )
                })()}
                  <div className="flex gap-0.5 bg-surface-800 border border-white/[0.06] rounded-lg p-0.5">
                  {[3, 6, 12, 60].map(n => (
                    <button
                      key={n}
                      onClick={() => {
                        setCfCustomError(null)
                        setCfRangeMode('preset')
                        setCfMonths(n)
                        setCfAnchor(cfMaxAnchor)
                        setCfCustomStart(yearMonthToInput(addMonths(cfMaxAnchor, -(n - 1))))
                        setCfCustomEnd(yearMonthToInput(cfMaxAnchor))
                      }}
                      className={clsx(
                        'px-3 py-1 rounded text-xs font-medium transition-colors',
                        cfRangeMode === 'preset' && cfMonths === n ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
                      )}
                    >
                      {n === 3 ? '3M' : n === 6 ? '6M' : n === 12 ? '1Y' : '5Y'}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setCfCustomError(null)
                      const start = yearMonthToInput(addMonths(cfAnchor, -(Math.max(1, cfMonths) - 1)))
                      const end = yearMonthToInput(cfAnchor)
                      setCfRangeMode('custom')
                      setCfCustomStart(start)
                      setCfCustomEnd(end)
                      applyCustomCfRange(start, end)
                    }}
                    className={clsx(
                      'px-3 py-1 rounded text-xs font-medium transition-colors',
                      cfRangeMode === 'custom' ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
                    )}
                  >
                    Custom
                  </button>
                </div>
                </div>

                {cfRangeMode === 'custom' && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="flex items-center gap-2 text-xs text-ink-300">
                      <input
                        type="month"
                        value={cfCustomStart}
                        max={yearMonthToInput(now)}
                        onChange={e => { const v = e.target.value; setCfCustomStart(v); applyCustomCfRange(v, cfCustomEnd) }}
                        className="bg-surface-800 border border-white/[0.06] rounded px-2 py-1 text-xs text-ink-200"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink-300">
                      To
                      <input
                        type="month"
                        value={cfCustomEnd}
                        max={yearMonthToInput(now)}
                        onChange={e => { const v = e.target.value; setCfCustomEnd(v); applyCustomCfRange(cfCustomStart, v) }}
                        className="bg-surface-800 border border-white/[0.06] rounded px-2 py-1 text-xs text-ink-200"
                      />
                    </label>
                    {cfCustomError && <span className="text-xs text-rose-400">{cfCustomError}</span>}
                  </div>
                )}
              </div>
            </div>

            {cfLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : cfTrends && monthCount > 0 ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Income', avg: avgIncome, total: totalIncome, colorClass: 'value-positive', sign: '' },
                    { label: 'Expenses', avg: avgExpenses, total: totalExpenses, colorClass: 'value-negative', sign: '' },
                    { label: 'Net Cash Flow', avg: avgNet, total: totalNet, colorClass: avgNet >= 0 ? 'value-positive' : 'value-negative', sign: 'signed' },
                  ].map((item, i) => (
                    <div key={item.label} className={clsx(i === 2 && 'col-span-2 md:col-span-1 flex justify-center')}>
                      <Card className={clsx('flex flex-col gap-1 w-full', i === 2 && 'max-md:w-1/2')}>
                        <span className="label text-ink-200">{item.label}</span>
                        <span className={clsx('stat-value', item.colorClass)}>
                          {item.sign === 'signed'
                            ? (item.avg > 0 ? `+${formatCurrencyWhole(item.avg)}` : item.avg < 0 ? `-${formatCurrencyWhole(Math.abs(item.avg))}` : formatCurrencyWhole(item.avg))
                            : formatCurrencyWhole(item.avg)
                          }
                          <span className="text-ink-300 text-xs font-normal ml-1">/mo</span>
                        </span>
                        <span className="text-xs text-ink-300 font-mono">
                          {item.sign === 'signed'
                            ? (item.total > 0 ? `+${formatCurrencyWhole(item.total)}` : item.total < 0 ? `-${formatCurrencyWhole(Math.abs(item.total))}` : formatCurrencyWhole(item.total))
                            : formatCurrencyWhole(item.total)
                          } total
                        </span>
                      </Card>
                    </div>
                  ))}
                </div>

                <div style={{ height: 380 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#8a8580', fontSize: 11, fontFamily: 'DM Mono' }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#8a8580', fontSize: 11, fontFamily: 'DM Mono' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => formatCurrencyCompact(v)}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                      <Tooltip
                        contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                        formatter={(value: number, name: string) => [
                          name === 'net' ? formatCurrencySignedWhole(value) : formatCurrencyWhole(Math.abs(value)),
                          name === 'income' ? 'Income' : name === 'expense' ? 'Expenses' : 'Net',
                        ]}
                        labelStyle={{ color: '#e8e6e3', marginBottom: 4 }}
                      />
                      <Bar dataKey="income" stackId="cf" fill="#34d4b1" radius={[3, 3, 0, 0]} barSize={barSize} />
                      <Bar dataKey="expense" stackId="cf" fill="#f87171" radius={[0, 0, 3, 3]} barSize={barSize} />
                      <Line
                        dataKey="net"
                        type="monotone"
                        stroke="#f5a623"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#f5a623', strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: '#f5a623', strokeWidth: 0 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
                No cash flow data yet
              </div>
            )}
          </Card>

          {cfTrends && cfSeries.length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <CardHeader title="Exclude Categories" />
                {excludedCfCategories.size > 0 && (
                  <button
                    onClick={() => setExcludedCfCategories(new Set())}
                    className="text-xs text-ink-400 hover:text-ink-200"
                  >
                    Clear exclusions
                  </button>
                )}
              </div>

              {incomeSeries.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-teal-400">Income</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExcludedCfCategories(prev => { const next = new Set(prev); incomeSeries.forEach(s => next.add(s.key)); return next })}
                        className="text-xs text-ink-400 hover:text-ink-200"
                      >Select all</button>
                      <span className="text-ink-600">·</span>
                      <button
                        onClick={() => setExcludedCfCategories(prev => { const next = new Set(prev); incomeSeries.forEach(s => next.delete(s.key)); return next })}
                        className="text-xs text-ink-400 hover:text-ink-200"
                      >Deselect all</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {incomeSeries.map(s => {
                      const avg = monthCount > 0 ? s.total / monthCount : 0
                      return (
                        <label key={s.key} className="flex items-center gap-2 text-xs text-ink-200 rounded border border-white/[0.06] px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={excludedCfCategories.has(s.key)}
                            onChange={() => toggleCfCategory(s.key)}
                            className="accent-amber-400"
                          />
                          <span className="truncate">
                            {s.name}
                            <span className="text-ink-300 ml-2">{formatCurrencyWhole(avg)}/mo</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {expenseSeries.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-medium text-rose-400">Expenses</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExcludedCfCategories(prev => { const next = new Set(prev); expenseSeries.forEach(s => next.add(s.key)); return next })}
                        className="text-xs text-ink-400 hover:text-ink-200"
                      >Select all</button>
                      <span className="text-ink-600">·</span>
                      <button
                        onClick={() => setExcludedCfCategories(prev => { const next = new Set(prev); expenseSeries.forEach(s => next.delete(s.key)); return next })}
                        className="text-xs text-ink-400 hover:text-ink-200"
                      >Deselect all</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {expenseSeries.map(s => {
                      const avg = monthCount > 0 ? s.total / monthCount : 0
                      return (
                        <label key={s.key} className="flex items-center gap-2 text-xs text-ink-200 rounded border border-white/[0.06] px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={excludedCfCategories.has(s.key)}
                            onChange={() => toggleCfCategory(s.key)}
                            className="accent-amber-400"
                          />
                          <span className="truncate">
                            {s.name}
                            <span className="text-ink-300 ml-2">{formatCurrencyWhole(avg)}/mo</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}
          </div>
        )
      })()}

      {/* Emergency Fund */}
      {activeTab === 'emergency-fund' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
              </div>
              <div className="text-right">
                <div className="label">{includeAllLiquidAssets ? 'Liquid Assets' : 'Cash Assets'}</div>
                <div className="font-mono text-lg text-teal-400">{formatCurrencyWhole(emergencyFundBase)}</div>
                <label className="mt-1 inline-flex items-center gap-2 text-2xs text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAllLiquidAssets}
                    onChange={e => setIncludeAllLiquidAssets(e.target.checked)}
                    className="accent-amber-400"
                  />
                  Include all liquid assets
                </label>
                <div className="mt-2 flex items-center justify-end gap-2 text-2xs">
                  <span className="text-ink-500">Target months expenses:</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={emergencyTargetMinMonths}
                    onChange={e => setEmergencyTargetMinMonths(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-14 bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-right text-ink-100 focus:outline-none focus:border-amber-400/40"
                  />
                  <span className="text-ink-400">-</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={emergencyTargetMaxMonths}
                    onChange={e => setEmergencyTargetMaxMonths(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                    className="w-14 bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-right text-ink-100 focus:outline-none focus:border-amber-400/40"
                  />
                </div>
              </div>
            </div>

            {emergencyLoading ? (
              <div className="flex justify-center py-8"><Spinner size="lg" /></div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: '3-Month Avg', avg: avg3, coverage: coverage3 },
                    { label: '6-Month Avg', avg: avg6, coverage: coverage6 },
                    { label: '12-Month Avg', avg: avg12, coverage: coverage12 },
                  ].map(row => {
                    const range = fundingRange(row.avg)
                    return (
                      <Card key={row.label} padding={false} className="p-4">
                        <div className="label text-ink-200">{row.label}</div>
                        <div className={clsx("font-mono text-xl mt-2", range?.status === 'within' ? 'text-teal-400' : range?.status === 'over' ? 'text-amber-400' : range?.status === 'under' ? 'text-rose-400' : 'text-ink-100')}>
                          {row.coverage != null ? `${row.coverage.toFixed(1)} months` : '-'}
                        </div>
                        {range?.status === 'under' && (
                          <div className="text-xs mt-1 text-rose-400">underfunded by <span className="font-mono">{formatCurrencyWhole(range.delta)}</span></div>
                        )}
                        {range?.status === 'over' && (
                          <div className="text-xs mt-1 text-amber-400">overfunded by <span className="font-mono">{formatCurrencyWhole(range.delta)}</span></div>
                        )}
                        <div className="text-xs text-ink-300 mt-1">Avg Expense: <span className="font-mono">{formatCurrencyWhole(row.avg)}</span></div>
                        <div className="text-xs text-ink-300 mt-1">Target Range: <span className="font-mono">{range ? `${formatCurrencyWhole(range.minTarget)} - ${formatCurrencyWhole(range.maxTarget)} (${targetMinMonths}-${targetMaxMonths} mo)` : '-'}</span></div>
                      </Card>
                    )
                  })}
                </div>

                <Card padding={false} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="label">Exclude Categories</h4>
                    <button
                      onClick={() => setExcludedEmergencyCategories(new Set())}
                      className="text-xs text-ink-400 hover:text-ink-200"
                    >
                      Clear exclusions
                    </button>
                  </div>
                  {emergencySeries.length === 0 ? (
                    <p className="text-xs text-ink-400">No expense category history available.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {emergencySeries
                        .slice()
                        .sort((a, b) => b.total - a.total)
                        .map(s => {
                          const catAvg = (months: number) => {
                            const slice = s.monthly.slice(-Math.min(months, s.monthly.length))
                            return slice.length > 0 ? slice.reduce((sum, v) => sum + (v ?? 0), 0) / slice.length : 0
                          }
                          const avgs = [catAvg(3), catAvg(6), catAvg(12)]
                          const mean = (Math.min(...avgs) + Math.max(...avgs)) / 2
                          const delta = Math.max(...avgs) - mean
                          return (
                            <label key={s.key} className="flex items-center gap-2 text-xs text-ink-200 rounded border border-white/[0.06] px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={excludedEmergencyCategories.has(s.key)}
                                onChange={() => toggleEmergencyCategory(s.key)}
                                className="accent-amber-400"
                              />
                              <span className="truncate">
                                {s.name}
                                <span className="text-ink-300 ml-2">
                                  {formatCurrencyWhole(mean)}{delta >= 1 ? ` \u00B1${formatCurrencyWhole(delta)}` : ''}/mo
                                </span>
                              </span>
                            </label>
                          )
                        })}
                    </div>
                  )}
                </Card>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}








