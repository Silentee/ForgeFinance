import { useMemo, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipProps,
} from 'recharts'
import {
  useCategories, useEarners, useIncomeEntries, useIncomeReport,
  useCreateEarner, useUpdateEarner, useDeleteEarner,
  useCreateIncomeEntry, useUpdateIncomeEntry, useDeleteIncomeEntry,
} from '@/hooks'
import { Button, Card, CheckboxRow, EmptyState, FilterDropdown, Modal, PageHeader, Spinner } from '@/components/ui'
import { currentYearMonth, formatCurrencyCompact, formatCurrencyWhole, formatDate, formatPercent, todayLocal } from '@/lib/format'
import { addMonths, type YearMonth } from './reports/shared'
import type { Earner, IncomeBonusYear, IncomeEarnerSeries, IncomeEntry, IncomeKind, IncomeReport } from '@/types'

// Categorical steps validated together with the take-home amber
// (dataviz validate_palette.js, dark mode, surface #161b24). Assigned to
// people in their fixed sort order, so a person keeps their color everywhere.
const EARNER_COLORS = ['#3987e5', '#199e70', '#9085e9', '#d55181']
const OVERFLOW_COLOR = '#8a8580' // a 5th+ person gets neutral ink, never a reused hue
const TAKE_HOME_COLOR = '#c98500'
const HOUSEHOLD_COLOR = '#c8c3bb'
const SURFACE_COLOR = '#161b24'
// A bonus target is drawn as a translucent track in the person's color, with
// the paid amount as a solid bar inside it.
const GHOST_OPACITY = 0.3

const AXIS_TICK = { fill: '#8a8580', fontSize: 11, fontFamily: 'DM Mono' }
const TOOLTIP_STYLE = {
  background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
  fontFamily: 'DM Mono', fontSize: 12,
}

const INPUT_CLASS =
  'w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40'

const KIND_LABELS: Record<IncomeKind, string> = {
  salary: 'Salary change',
  bonus: 'Annual bonus',
  award: 'Award',
  other: 'Other one-time',
}

const RANGE_OPTIONS: { years: number | null; label: string }[] = [
  { years: 3, label: '3Y' },
  { years: 5, label: '5Y' },
  { years: 10, label: '10Y' },
  { years: null, label: 'All' },
]

// Which income categories count as take-home pay is a per-browser view
// preference; null means "use the server default" (Salary & Wages + Bonus).
const TAKE_HOME_STORAGE_KEY = 'forge.income.takeHomeCategoryIds'

function loadTakeHomeIds(): number[] | null {
  try {
    const raw = localStorage.getItem(TAKE_HOME_STORAGE_KEY)
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every(n => typeof n === 'number') ? parsed : null
  } catch {
    return null
  }
}

function saveTakeHomeIds(ids: number[] | null) {
  try {
    if (ids == null) localStorage.removeItem(TAKE_HOME_STORAGE_KEY)
    else localStorage.setItem(TAKE_HOME_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage blocked — the choice just won't persist.
  }
}

const earnerKey = (id: number) => `e${id}`
const round2 = (v: number) => Math.round(v * 100) / 100
const sumSlice = (arr: number[], from: number, to: number) =>
  arr.slice(Math.max(0, from), Math.max(0, to)).reduce((a, b) => a + b, 0)
// "15%", "12.5%": a target % as entered, without padding decimals.
const pctLabel = (v: number) => `${Number(v.toFixed(2))}%`

function earnerColors(earners: Earner[] | undefined): Map<number, string> {
  const map = new Map<number, string>()
  ;(earners ?? []).forEach((e, i) => map.set(e.id, e.color ?? EARNER_COLORS[i] ?? OVERFLOW_COLOR))
  return map
}

// ─── Bucketing ────────────────────────────────────────────────────────────────

interface Bucket {
  key: string
  label: string
  byEarner: Record<number, number>
  household: number
  takeHome: number
  partial: boolean
}

/** Roll the report's months up into years (or keep them monthly), dropping
 *  leading buckets from before any income was recorded or deposited. */
function buildBuckets(report: IncomeReport, mode: 'year' | 'month', anchor: YearMonth): Bucket[] {
  const buckets: Bucket[] = []
  report.months.forEach((mk, i) => {
    const key = mode === 'year' ? mk.slice(0, 4) : mk
    let b = buckets[buckets.length - 1]
    if (!b || b.key !== key) {
      const partial = mode === 'year' && Number(key) === anchor.year && anchor.month < 12
      b = {
        key,
        label: mode === 'year' ? (partial ? `${key} YTD` : key) : report.month_labels[i],
        byEarner: {},
        household: 0,
        takeHome: 0,
        partial,
      }
      buckets.push(b)
    }
    for (const e of report.earners) {
      b.byEarner[e.earner_id] = (b.byEarner[e.earner_id] ?? 0) + e.monthly_gross[i]
    }
    b.household += report.household_monthly_gross[i]
    b.takeHome += report.monthly_take_home[i]
  })
  const first = buckets.findIndex(b => Math.abs(b.household) > 0.005 || Math.abs(b.takeHome) > 0.005)
  return first === -1 ? [] : buckets.slice(first)
}

// ─── Annual bonus ─────────────────────────────────────────────────────────────

interface BonusYearGroup {
  year: number
  inProgress: boolean
  rows: { earner: IncomeEarnerSeries; bonus: IncomeBonusYear }[]
  target: number
  paid: number
  // Household attainment, only once everyone with a target has been paid.
  attainment: number | null
}

/** Pairs of people whose bonus for the year has both a target and a payout. */
function scoredRows(group: BonusYearGroup) {
  return group.rows.filter(r => (r.bonus.target_amount ?? 0) > 0 && r.bonus.actual_amount != null)
}

/** Each performance year across everyone, newest first. */
function groupBonusYears(earners: IncomeEarnerSeries[]): BonusYearGroup[] {
  const byYear = new Map<number, BonusYearGroup>()
  for (const earner of earners) {
    for (const bonus of earner.bonus_years) {
      let g = byYear.get(bonus.year)
      if (!g) {
        g = { year: bonus.year, inProgress: bonus.in_progress, rows: [], target: 0, paid: 0, attainment: null }
        byYear.set(bonus.year, g)
      }
      g.rows.push({ earner, bonus })
      g.target += bonus.target_amount ?? 0
      g.paid += bonus.actual_amount ?? 0
    }
  }
  for (const g of byYear.values()) {
    const targeted = g.rows.filter(r => (r.bonus.target_amount ?? 0) > 0)
    const scored = scoredRows(g)
    if (targeted.length > 0 && scored.length === targeted.length) {
      g.attainment = (scored.reduce((s, r) => s + (r.bonus.actual_amount ?? 0), 0) / g.target) * 100
    }
  }
  return Array.from(byYear.values()).sort((a, b) => b.year - a.year)
}

/** Bar path with rounded top corners and a square base. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

type BonusChartRow = { label: string; year: number; [key: string]: string | number | null }

/** One person's bar for a year: the target as a translucent track and the paid
 *  amount as a narrower solid bar inside it. The Bar's value is the larger of
 *  the two, so its height gives the pixel scale for both. */
function BonusBarShape({ x, y, width, height, payload, earnerId, color }: {
  x: number; y: number; width: number; height: number; payload: BonusChartRow; earnerId: number; color: string
}) {
  const key = earnerKey(earnerId)
  const top = Number(payload[key] ?? 0)
  if (!top || !(height > 0)) return <g />
  const target = Number(payload[`${key}_target`] ?? 0)
  const paid = payload[`${key}_paid`]
  const base = y + height
  const px = height / top
  const inner = Math.max(4, Math.round(width * 0.5))
  return (
    <g>
      {target > 0 && (
        <path d={topRoundedRect(x, base - target * px, width, target * px, 4)} fill={color} fillOpacity={GHOST_OPACITY} />
      )}
      {paid != null && Number(paid) > 0 && (
        <path d={topRoundedRect(x + (width - inner) / 2, base - Number(paid) * px, inner, Number(paid) * px, 3)} fill={color} />
      )}
    </g>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

type SwatchKind = 'bar' | 'line' | 'ghost'

function Swatch({ color, kind = 'bar' }: { color: string; kind?: SwatchKind }) {
  return kind === 'line'
    ? <span className="inline-block w-4 border-t-2 shrink-0" style={{ borderColor: color }} />
    : <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color, opacity: kind === 'ghost' ? GHOST_OPACITY : 1 }} />
}

function ChartLegend({ items }: { items: { label: string; color: string; kind: SwatchKind }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ink-300">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-2">
          <Swatch color={it.color} kind={it.kind} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

function TooltipRow({ name, value, swatch, kind }: { name: string; value: string; swatch?: string; kind?: SwatchKind }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="inline-flex items-center gap-2 text-ink-300">
        {swatch && <Swatch color={swatch} kind={kind} />}
        {name}
      </span>
      <span className="text-ink-100">{value}</span>
    </div>
  )
}

type ChartRow = { label: string; household: number; takeHome: number | null; [key: string]: string | number | null }

function GrossTooltip({
  active, payload, label, earners, colors,
}: TooltipProps<number, string> & { earners: IncomeReport['earners']; colors: Map<number, string> }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as ChartRow
  const rate = row.household > 0 && row.takeHome != null ? (row.takeHome / row.household) * 100 : null
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-1 min-w-[220px]">
      <div className="text-ink-100 mb-1">{label}</div>
      {earners.map(e => (
        <TooltipRow
          key={e.earner_id}
          name={e.name}
          value={formatCurrencyWhole(Number(row[earnerKey(e.earner_id)] ?? 0))}
          swatch={colors.get(e.earner_id)}
        />
      ))}
      {earners.length > 1 && <TooltipRow name="Household gross" value={formatCurrencyWhole(row.household)} />}
      {row.takeHome != null && (
        <TooltipRow name="Take-home" value={formatCurrencyWhole(row.takeHome)} swatch={TAKE_HOME_COLOR} kind="line" />
      )}
      {rate != null && <TooltipRow name="Take-home rate" value={formatPercent(rate)} />}
    </div>
  )
}

function bonusSummary(target: number | null, paid: number | null, attainment: number | null): string {
  if (paid == null) return target ? `${formatCurrencyWhole(target)} target` : '—'
  if (!target || attainment == null) return `${formatCurrencyWhole(paid)} paid`
  return `${formatCurrencyWhole(paid)} of ${formatCurrencyWhole(target)} · ${formatPercent(attainment, 0)}`
}

function BonusTooltip({
  active, payload, label, groups, colors,
}: TooltipProps<number, string> & { groups: Map<number, BonusYearGroup>; colors: Map<number, string> }) {
  if (!active || !payload?.length) return null
  const group = groups.get((payload[0].payload as BonusChartRow).year)
  if (!group) return null
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-1 min-w-[260px]">
      <div className="text-ink-100 mb-1">
        {label} bonus{group.inProgress && <span className="text-ink-400"> · year in progress</span>}
      </div>
      {group.rows.map(({ earner, bonus }) => (
        <TooltipRow
          key={earner.earner_id}
          name={earner.name}
          value={bonusSummary(bonus.target_amount, bonus.actual_amount, bonus.attainment_pct)}
          swatch={colors.get(earner.earner_id)}
        />
      ))}
      {group.rows.length > 1 && (
        <TooltipRow
          name="Household"
          value={bonusSummary(group.target || null, group.paid || null, group.attainment)}
        />
      )}
    </div>
  )
}

function AttainmentCell({ value, padding = 'py-2' }: { value: number | null; padding?: string }) {
  return (
    <td className={clsx(
      padding,
      'text-right font-mono tabular-nums whitespace-nowrap',
      value == null ? 'text-ink-400' : value >= 100 ? 'text-teal-400' : 'text-rose-400',
    )}>
      {value == null ? '—' : formatPercent(value, 0)}
    </td>
  )
}

function SegmentedControl<T extends string | number | null>({ options, value, onChange }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 bg-surface-800 border border-white/[0.06] rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.label}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-3 py-1 rounded text-xs font-medium transition-colors',
            value === o.value ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IncomePage() {
  // Anchor at the last complete month, like Cash Flow, so the newest bucket
  // isn't a half-finished month.
  const anchor = addMonths(currentYearMonth(), -1)

  const [rangeYears, setRangeYears] = useState<number | null>(5)
  const [bucketMode, setBucketMode] = useState<'year' | 'month'>('year')
  const [grossView, setGrossView] = useState<'chart' | 'table'>('chart')
  const [takeHomeIds, setTakeHomeIdsState] = useState<number[] | null>(loadTakeHomeIds)
  const [personFilter, setPersonFilter] = useState<number | null>(null)
  const [editing, setEditing] = useState<IncomeEntry | 'new' | null>(null)
  const [showPeople, setShowPeople] = useState(false)
  const [salaryView, setSalaryView] = useState<'base' | 'total'>('base')

  const { data: earners, isLoading: earnersLoading } = useEarners()
  const { data: entries } = useIncomeEntries()
  const { data: incomeCategories } = useCategories({ flat: true, income_only: true })

  // Whole calendar years: January of the start year through the anchor month.
  const earliestYear = entries?.length
    ? Math.min(...entries.map(e => Number(e.effective_date.slice(0, 4))))
    : anchor.year
  const startYear = rangeYears == null ? Math.min(earliestYear, anchor.year) : anchor.year - rangeYears + 1
  const months = Math.min(600, (anchor.year - startYear) * 12 + anchor.month)

  const { data: report, isFetching } = useIncomeReport({
    months,
    year: anchor.year,
    month: anchor.month,
    takeHomeCategoryIds: takeHomeIds ?? undefined,
  })

  const setTakeHomeIds = (ids: number[] | null) => {
    setTakeHomeIdsState(ids)
    saveTakeHomeIds(ids)
  }

  const colors = useMemo(() => earnerColors(earners), [earners])

  const salaryChange = useMemo(() => {
    // entry id -> % change vs the same person's previous salary
    const changes = new Map<number, number | null>()
    const lastByEarner = new Map<number, IncomeEntry>()
    const salaries = (entries ?? [])
      .filter(e => e.kind === 'salary')
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.id - b.id)
    for (const e of salaries) {
      const prev = lastByEarner.get(e.earner_id)
      changes.set(e.id, prev && prev.amount > 0 ? ((e.amount - prev.amount) / prev.amount) * 100 : null)
      lastByEarner.set(e.earner_id, e)
    }
    return changes
  }, [entries])

  if (earnersLoading) {
    return (
      <div className="space-y-6 animate-slide-up">
        <PageHeader title="Income" />
        <div className="flex justify-center py-8"><Spinner size="lg" /></div>
      </div>
    )
  }

  if (!earners?.length) {
    return (
      <div className="space-y-6 animate-slide-up">
        <PageHeader title="Income" />
        <Card>
          <EmptyState
            title="Track your household's gross income"
            description="Add each person who earns income, then record their salary whenever it changes, plus any bonuses. You'll see how gross pay grows over time and how much of it reaches your accounts."
            action={<Button variant="primary" onClick={() => setShowPeople(true)}>Add a person</Button>}
          />
        </Card>
        {showPeople && <ManagePeopleModal earners={[]} colors={colors} onClose={() => setShowPeople(false)} />}
      </div>
    )
  }

  // ── Report-derived numbers ──
  const n = report?.months.length ?? 0
  const hasTakeHome = (report?.take_home_category_ids.length ?? 0) > 0
  const ttmGross = report ? sumSlice(report.household_monthly_gross, n - 12, n) : 0
  const priorGross = report && n >= 24 ? sumSlice(report.household_monthly_gross, n - 24, n - 12) : 0
  const ttmTakeHome = report ? sumSlice(report.monthly_take_home, n - 12, n) : 0
  const grossChange = priorGross > 0 ? ((ttmGross - priorGross) / priorGross) * 100 : null
  const takeHomeRate = hasTakeHome && ttmGross > 0 ? (ttmTakeHome / ttmGross) * 100 : null

  const seriesEarners = report?.earners ?? []
  const chartBuckets = report ? buildBuckets(report, bucketMode, anchor) : []
  const chartData: ChartRow[] = chartBuckets.map(b => ({
    label: b.label,
    household: round2(b.household),
    takeHome: hasTakeHome ? round2(b.takeHome) : null,
    ...Object.fromEntries(seriesEarners.map(e => [earnerKey(e.earner_id), round2(b.byEarner[e.earner_id] ?? 0)])),
  }))
  const barSize = chartData.length <= 12 ? 28 : chartData.length <= 24 ? 18 : chartData.length <= 60 ? 8 : 4
  const showDots = chartData.length <= 24

  const yearRows = report ? buildBuckets(report, 'year', anchor) : []

  // ── Annual bonus ──
  const householdBaseSalary = report?.current_household_salary ?? 0
  const householdTargetBonus = report?.current_household_target_bonus ?? 0
  const bonusGroups = groupBonusYears(seriesEarners)
  const bonusGroupsByYear = new Map(bonusGroups.map(g => [g.year, g]))
  // Headline: the newest finished year with a payout to score against a target.
  const latestScored = bonusGroups.find(g => !g.inProgress && scoredRows(g).length > 0)
  const latestScoredTarget = latestScored
    ? scoredRows(latestScored).reduce((s, r) => s + (r.bonus.target_amount ?? 0), 0)
    : 0
  const latestScoredPaid = latestScored
    ? scoredRows(latestScored).reduce((s, r) => s + (r.bonus.actual_amount ?? 0), 0)
    : 0
  const latestAttainment = latestScoredTarget > 0 ? (latestScoredPaid / latestScoredTarget) * 100 : null
  const bonusEarners = seriesEarners.filter(e => e.bonus_years.length > 0)
  const bonusChartData: BonusChartRow[] = [...bonusGroups].reverse().map(g => {
    const row: BonusChartRow = { label: String(g.year), year: g.year }
    for (const { earner, bonus } of g.rows) {
      const key = earnerKey(earner.earner_id)
      row[key] = Math.max(bonus.target_amount ?? 0, bonus.actual_amount ?? 0)
      row[`${key}_target`] = bonus.target_amount
      row[`${key}_paid`] = bonus.actual_amount
    }
    return row
  })
  const bonusBarSize = Math.max(
    6,
    Math.min(28, Math.floor(560 / Math.max(1, bonusChartData.length * Math.max(1, bonusEarners.length)))),
  )

  // Salary steps are monthly regardless of the bucket toggle. "Total" adds
  // each month's target bonus on top of base (target total comp).
  const hasTargets = seriesEarners.some(e => e.monthly_target_bonus_pct.some(p => (p ?? 0) > 0))
  const showTotalComp = hasTargets && salaryView === 'total'
  const salaryRowsAll = report
    ? report.months.map((_, i) => {
        const row: Record<string, string | number | null> = { label: report.month_labels[i] }
        let total = 0
        let any = false
        for (const e of report.earners) {
          const base = e.monthly_salary_rate[i]
          const rate = base != null && showTotalComp
            ? round2(base * (1 + (e.monthly_target_bonus_pct[i] ?? 0) / 100))
            : base
          row[earnerKey(e.earner_id)] = rate
          if (rate != null) { total += rate; any = true }
        }
        row.household = any ? total : null
        return row
      })
    : []
  const firstSalaryIdx = salaryRowsAll.findIndex(r => r.household != null)
  const salaryData = firstSalaryIdx === -1 ? [] : salaryRowsAll.slice(firstSalaryIdx)
  const salaryEarners = seriesEarners.filter(e => e.monthly_salary_rate.some(r => r != null))
  const showHouseholdSalary = salaryEarners.length > 1

  // ── Take-home category picker ──
  const pickableCategories = (incomeCategories ?? []).filter(
    c => c.parent_id != null || !(incomeCategories ?? []).some(ch => ch.parent_id === c.id)
  )
  const effectiveTakeHome = new Set(takeHomeIds ?? report?.take_home_category_ids ?? [])
  const takeHomeLabel = (() => {
    if (effectiveTakeHome.size === 0) return 'Take-home: none'
    const names = Array.from(effectiveTakeHome).map(id => (incomeCategories ?? []).find(c => c.id === id)?.name)
    if (names.length <= 2 && names.every(Boolean)) return `Take-home: ${names.join(', ')}`
    return `Take-home: ${effectiveTakeHome.size} ${effectiveTakeHome.size === 1 ? 'category' : 'categories'}`
  })()
  const toggleTakeHome = (id: number) => {
    const next = new Set(effectiveTakeHome)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setTakeHomeIds(Array.from(next).sort((a, b) => a - b))
  }

  const visibleEntries = (entries ?? []).filter(e => personFilter == null || e.earner_id === personFilter)

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title="Income"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowPeople(true)}>Manage people</Button>
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>Add entry</Button>
          </div>
        }
      />

      <div className="space-y-4">
        {/* One control row scopes every chart and tile below it. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown buttonLabel={takeHomeLabel} isActive={takeHomeIds != null} disabled={!incomeCategories}>
            <p className="px-2.5 pt-1 pb-2 text-xs text-ink-400">
              Income categories your paychecks are filed under. Their deposits are compared against gross.
            </p>
            {pickableCategories.map(c => (
              <CheckboxRow
                key={c.id}
                checked={effectiveTakeHome.has(c.id)}
                label={c.name}
                onToggle={() => toggleTakeHome(c.id)}
              />
            ))}
            {takeHomeIds != null && (
              <>
                <div className="h-px bg-white/[0.06] my-1" />
                <button
                  type="button"
                  onClick={() => setTakeHomeIds(null)}
                  className="w-full text-left px-2.5 py-2 text-xs text-ink-400 hover:text-ink-100"
                >
                  Reset to Salary &amp; Wages + Bonus
                </button>
              </>
            )}
          </FilterDropdown>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SegmentedControl<'year' | 'month'>
              options={[{ value: 'year', label: 'Yearly' }, { value: 'month', label: 'Monthly' }]}
              value={bucketMode}
              onChange={setBucketMode}
            />
            <SegmentedControl
              options={RANGE_OPTIONS.map(o => ({ value: o.years, label: o.label }))}
              value={rangeYears}
              onChange={setRangeYears}
            />
          </div>
        </div>

        <div className={clsx('grid grid-cols-1 gap-4', bonusGroups.length > 0 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3')}>
          <Card padding={false} className="p-4">
            <div className="label text-ink-200">Household Salary</div>
            <div className="font-mono text-xl mt-2 text-ink-100">
              {formatCurrencyWhole(householdBaseSalary + householdTargetBonus)}
              <span className="text-ink-300 text-xs font-normal ml-1">/yr</span>
            </div>
            <div className="text-xs text-ink-400 mt-1 truncate">
              {formatCurrencyWhole(householdBaseSalary)} base salary
            </div>
          </Card>
          <Card padding={false} className="p-4">
            <div className="label text-ink-200">Gross, Last 12 Months</div>
            <div className="font-mono text-xl mt-2 text-ink-100">{formatCurrencyWhole(ttmGross)}</div>
            <div className="text-xs mt-1">
              {grossChange != null ? (
                <span className={grossChange >= 0 ? 'text-teal-400' : 'text-rose-400'}>
                  {grossChange >= 0 ? '+' : ''}{formatPercent(grossChange)}
                  <span className="text-ink-300"> vs prior 12 months</span>
                </span>
              ) : (
                <span className="text-ink-300">salary plus bonuses</span>
              )}
            </div>
          </Card>
          <Card padding={false} className="p-4">
            <div className="label text-ink-200">Take-Home Rate</div>
            <div className="font-mono text-xl mt-2 text-ink-100">{takeHomeRate != null ? formatPercent(takeHomeRate) : '—'}</div>
            <div className="text-xs text-ink-300 mt-1">
              {!hasTakeHome
                ? 'Pick the categories your paychecks land in'
                : takeHomeRate == null
                  ? 'No gross income in the last 12 months'
                  : `${formatCurrencyWhole(ttmTakeHome)} take-home of ${formatCurrencyWhole(ttmGross)} gross`}
            </div>
            {takeHomeRate != null && takeHomeRate > 100 && (
              <div className="text-xs text-amber-400 mt-1">
                More take-home than gross. Is everyone's salary entered?
              </div>
            )}
          </Card>
          {bonusGroups.length > 0 && (
            <Card padding={false} className="p-4">
              <div className="label text-ink-200">Bonus vs Target</div>
              <div className="font-mono text-xl mt-2 text-ink-100">
                {latestAttainment != null ? formatPercent(latestAttainment, 0) : '—'}
              </div>
              <div className="text-xs text-ink-300 mt-1 truncate">
                {latestScored
                  ? `${latestScored.year}: ${formatCurrencyWhole(latestScoredPaid)} paid of ${formatCurrencyWhole(latestScoredTarget)} target`
                  : 'No annual bonus paid against a target yet'}
              </div>
            </Card>
          )}
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h4 className="label">Gross vs. Take-Home</h4>
            <SegmentedControl<'chart' | 'table'>
              options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]}
              value={grossView}
              onChange={setGrossView}
            />
          </div>
          {chartData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              No income recorded in this range yet. Add a salary entry to get started.
            </div>
          ) : (
            <div className={clsx('space-y-4 transition-opacity', isFetching && 'opacity-60')}>
              {grossView === 'chart' ? (
                <>
                  <div style={{ height: 340 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="label"
                          tick={AXIS_TICK}
                          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                          tickLine={false}
                          interval="preserveStartEnd"
                          minTickGap={16}
                        />
                        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                          content={<GrossTooltip earners={seriesEarners} colors={colors} />}
                        />
                        {seriesEarners.map((e, i) => (
                          <Bar
                            key={e.earner_id}
                            dataKey={earnerKey(e.earner_id)}
                            name={e.name}
                            stackId="gross"
                            fill={colors.get(e.earner_id)}
                            // A surface-colored stroke leaves a gap between stacked segments.
                            stroke={SURFACE_COLOR}
                            strokeWidth={2}
                            radius={i === seriesEarners.length - 1 ? [4, 4, 0, 0] : 0}
                            barSize={barSize}
                            isAnimationActive={false}
                          />
                        ))}
                        {hasTakeHome && (
                          <Line
                            dataKey="takeHome"
                            name="Take-home"
                            type="monotone"
                            stroke={TAKE_HOME_COLOR}
                            strokeWidth={2}
                            dot={showDots ? { r: 4, fill: TAKE_HOME_COLOR, stroke: SURFACE_COLOR, strokeWidth: 2 } : false}
                            activeDot={{ r: 5, fill: TAKE_HOME_COLOR, stroke: SURFACE_COLOR, strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <ChartLegend
                    items={[
                      ...seriesEarners.map(e => ({ label: `${e.name} gross`, color: colors.get(e.earner_id) ?? OVERFLOW_COLOR, kind: 'bar' as const })),
                      ...(hasTakeHome ? [{ label: 'Take-home', color: TAKE_HOME_COLOR, kind: 'line' as const }] : []),
                    ]}
                  />
                </>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-2xs uppercase tracking-wider text-ink-400 border-b border-white/[0.06]">
                        <th className="py-2 pr-3 font-medium">Year</th>
                        {seriesEarners.length > 1 && seriesEarners.map(e => (
                          <th key={e.earner_id} className="py-2 pr-3 font-medium text-right whitespace-nowrap">{e.name}</th>
                        ))}
                        <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">
                          {seriesEarners.length > 1 ? 'Household gross' : 'Gross'}
                        </th>
                        <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">vs prior year</th>
                        {hasTakeHome && <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Take-home</th>}
                        {hasTakeHome && <th className="py-2 font-medium text-right whitespace-nowrap">Rate</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {[...yearRows].reverse().map(row => {
                        const prev = yearRows[yearRows.indexOf(row) - 1]
                        const change = !row.partial && prev && prev.household > 0
                          ? ((row.household - prev.household) / prev.household) * 100
                          : null
                        const rate = row.household > 0 ? (row.takeHome / row.household) * 100 : null
                        return (
                          <tr key={row.key} className="border-b border-white/[0.04] last:border-0">
                            <td className="py-2.5 pr-3 text-ink-100 whitespace-nowrap">{row.label}</td>
                            {seriesEarners.length > 1 && seriesEarners.map(e => (
                              <td key={e.earner_id} className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink-200">
                                {formatCurrencyWhole(row.byEarner[e.earner_id] ?? 0)}
                              </td>
                            ))}
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink-100">
                              {formatCurrencyWhole(row.household)}
                            </td>
                            <td className={clsx(
                              'py-2.5 pr-3 text-right font-mono tabular-nums',
                              change == null ? 'text-ink-400' : change >= 0 ? 'text-teal-400' : 'text-rose-400'
                            )}>
                              {change == null ? '—' : `${change >= 0 ? '+' : ''}${formatPercent(change)}`}
                            </td>
                            {hasTakeHome && (
                              <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink-200">
                                {formatCurrencyWhole(row.takeHome)}
                              </td>
                            )}
                            {hasTakeHome && (
                              <td className="py-2.5 text-right font-mono tabular-nums text-ink-200">
                                {rate == null ? '—' : formatPercent(rate)}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-2xs text-ink-400 text-center max-w-2xl mx-auto">
                Take-home is what the selected categories received in your tracked accounts. The gap to gross is
                taxes plus pre-tax deductions (401k, health, HSA), and any pay deposited somewhere you don't track.
              </p>
            </div>
          )}
        </Card>

        {bonusGroups.length > 0 && (
          <Card>
            <h4 className="label mb-4">Annual Bonus: Target vs Actual</h4>
            <div className={clsx('space-y-4 transition-opacity', isFetching && 'opacity-60')}>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bonusChartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barGap={4}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      content={<BonusTooltip groups={bonusGroupsByYear} colors={colors} />}
                    />
                    {bonusEarners.map(e => (
                      <Bar
                        key={e.earner_id}
                        dataKey={earnerKey(e.earner_id)}
                        name={e.name}
                        fill={colors.get(e.earner_id)}
                        barSize={bonusBarSize}
                        isAnimationActive={false}
                        shape={(props: unknown) => (
                          <BonusBarShape
                            {...(props as { x: number; y: number; width: number; height: number; payload: BonusChartRow })}
                            earnerId={e.earner_id}
                            color={colors.get(e.earner_id) ?? OVERFLOW_COLOR}
                          />
                        )}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend
                items={[
                  ...(bonusEarners.length > 1
                    ? bonusEarners.map(e => ({ label: e.name, color: colors.get(e.earner_id) ?? OVERFLOW_COLOR, kind: 'bar' as const }))
                    : []),
                  { label: 'Target', color: HOUSEHOLD_COLOR, kind: 'ghost' as const },
                  { label: 'Paid', color: HOUSEHOLD_COLOR, kind: 'bar' as const },
                ]}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wider text-ink-400 border-b border-white/[0.06]">
                      <th className="py-2 pr-3 font-medium whitespace-nowrap">Performance year</th>
                      {bonusEarners.length > 1 && <th className="py-2 pr-3 font-medium">Person</th>}
                      <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Year-end base</th>
                      <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Target %</th>
                      <th className="py-2 pr-3 font-medium text-right">Target</th>
                      <th className="py-2 pr-3 font-medium text-right">Paid</th>
                      <th className="py-2 font-medium text-right whitespace-nowrap">% of target</th>
                    </tr>
                  </thead>
                  {bonusGroups.map(g => (
                    <tbody key={g.year} className="border-b border-white/[0.06] last:border-0">
                      {g.rows.map(({ earner, bonus }, i) => (
                        <tr key={earner.earner_id}>
                          <td className="py-2 pr-3 text-ink-100 whitespace-nowrap">
                            {i === 0 && (
                              <>
                                {g.year}
                                {g.inProgress && <span className="text-ink-400 text-xs"> · in progress</span>}
                              </>
                            )}
                          </td>
                          {bonusEarners.length > 1 && (
                            <td className="py-2 pr-3 text-ink-200 whitespace-nowrap">
                              <span className="inline-flex items-center gap-2">
                                <Swatch color={colors.get(earner.earner_id) ?? OVERFLOW_COLOR} />
                                {earner.name}
                              </span>
                            </td>
                          )}
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-200">
                            {bonus.base_salary != null ? formatCurrencyWhole(bonus.base_salary) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-200">
                            {bonus.target_pct ? pctLabel(bonus.target_pct) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-200">
                            {bonus.target_amount ? formatCurrencyWhole(bonus.target_amount) : '—'}
                          </td>
                          <td className={clsx(
                            'py-2 pr-3 text-right whitespace-nowrap',
                            bonus.actual_amount != null ? 'font-mono tabular-nums text-ink-100' : 'text-xs text-ink-400'
                          )}>
                            {bonus.actual_amount != null
                              ? formatCurrencyWhole(bonus.actual_amount)
                              : g.inProgress ? 'Expected' : 'Not entered'}
                          </td>
                          <AttainmentCell value={bonus.attainment_pct} />
                        </tr>
                      ))}
                      {g.rows.length > 1 && (
                        <tr className="text-ink-100">
                          <td className="pb-2.5 pr-3" />
                          {bonusEarners.length > 1 && <td className="pb-2.5 pr-3 text-ink-300">Household</td>}
                          <td className="pb-2.5 pr-3" />
                          <td className="pb-2.5 pr-3" />
                          <td className="pb-2.5 pr-3 text-right font-mono tabular-nums">
                            {g.target ? formatCurrencyWhole(g.target) : '—'}
                          </td>
                          <td className="pb-2.5 pr-3 text-right font-mono tabular-nums">
                            {g.paid ? formatCurrencyWhole(g.paid) : '—'}
                          </td>
                          <AttainmentCell value={g.attainment} padding="pb-2.5" />
                        </tr>
                      )}
                    </tbody>
                  ))}
                </table>
              </div>
              <p className="text-2xs text-ink-400 text-center max-w-2xl mx-auto">
                Target is the bonus % on the salary in effect on Dec 31, times that base. Annual bonuses count toward
                the performance year they're for, wherever they were paid; gross charts above count them in the month paid.
              </p>
            </div>
          </Card>
        )}

        {salaryData.length > 0 && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h4 className="label">
                {showTotalComp ? 'Target Total Comp (Base + Target Bonus)' : 'Salary History (Annual Base)'}
              </h4>
              {hasTargets && (
                <SegmentedControl<'base' | 'total'>
                  options={[{ value: 'base', label: 'Base' }, { value: 'total', label: 'Base + target bonus' }]}
                  value={salaryView}
                  onChange={setSalaryView}
                />
              )}
            </div>
            <div className={clsx('space-y-4 transition-opacity', isFetching && 'opacity-60')}>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salaryData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatCurrencyCompact(v)} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#e8e6e3', marginBottom: 4 }}
                      itemStyle={{ color: '#c8c3bb' }}
                      formatter={(value: number, name: string) => [value == null ? '—' : `${formatCurrencyWhole(value)}/yr`, name]}
                    />
                    {salaryEarners.map(e => (
                      <Line
                        key={e.earner_id}
                        dataKey={earnerKey(e.earner_id)}
                        name={e.name}
                        type="stepAfter"
                        stroke={colors.get(e.earner_id)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: colors.get(e.earner_id), stroke: SURFACE_COLOR, strokeWidth: 2 }}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                    {showHouseholdSalary && (
                      <Line
                        dataKey="household"
                        name="Household"
                        type="stepAfter"
                        stroke={HOUSEHOLD_COLOR}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: HOUSEHOLD_COLOR, stroke: SURFACE_COLOR, strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend
                items={[
                  ...salaryEarners.map(e => ({ label: e.name, color: colors.get(e.earner_id) ?? OVERFLOW_COLOR, kind: 'line' as const })),
                  ...(showHouseholdSalary ? [{ label: 'Household', color: HOUSEHOLD_COLOR, kind: 'line' as const }] : []),
                ]}
              />
            </div>
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="label">Income History</h4>
            {earners.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {[{ id: null as number | null, name: 'Everyone' }, ...earners.map(e => ({ id: e.id as number | null, name: e.name }))].map(p => (
                  <button
                    key={p.id ?? 'all'}
                    type="button"
                    onClick={() => setPersonFilter(p.id)}
                    className={clsx(
                      'px-2.5 py-1 rounded-full text-xs border transition-colors',
                      personFilter === p.id
                        ? 'border-amber-400/40 bg-amber-400/5 text-amber-300'
                        : 'border-white/[0.08] text-ink-300 hover:text-ink-100'
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {visibleEntries.length === 0 ? (
            <p className="text-xs text-ink-400 py-4">
              No income entries yet. Add each person's salary (and every raise or job change after it) with
              "Add entry".
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wider text-ink-400 border-b border-white/[0.06]">
                    <th className="py-2 pr-3 font-medium whitespace-nowrap">Date</th>
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium text-right">Amount</th>
                    <th className="py-2 pr-3 font-medium text-right">Change</th>
                    <th className="py-2 pr-3 font-medium">Employer</th>
                    <th className="py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map(entry => {
                    const change = salaryChange.get(entry.id)
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => setEditing(entry)}
                        className="border-b border-white/[0.04] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="py-2.5 pr-3 text-ink-200 whitespace-nowrap">{formatDate(entry.effective_date)}</td>
                        <td className="py-2.5 pr-3 text-ink-100 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <Swatch color={colors.get(entry.earner_id) ?? OVERFLOW_COLOR} />
                            {entry.earner_name}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-ink-200 whitespace-nowrap">
                          {KIND_LABELS[entry.kind]}
                          {entry.kind === 'bonus' && entry.bonus_year != null && (
                            <span className="text-ink-400"> · {entry.bonus_year}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink-100 whitespace-nowrap">
                          {formatCurrencyWhole(entry.amount)}
                          {entry.kind === 'salary' && <span className="text-ink-400">/yr</span>}
                          {entry.kind === 'salary' && (entry.target_bonus_pct ?? 0) > 0 && (
                            <span className="text-ink-400"> · {pctLabel(entry.target_bonus_pct ?? 0)} bonus</span>
                          )}
                        </td>
                        <td className={clsx(
                          'py-2.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap',
                          change == null ? 'text-ink-400' : change >= 0 ? 'text-teal-400' : 'text-rose-400'
                        )}>
                          {change == null ? '—' : `${change >= 0 ? '+' : ''}${formatPercent(change)}`}
                        </td>
                        <td className="py-2.5 pr-3 text-ink-200 truncate max-w-[180px]">{entry.employer || '—'}</td>
                        <td className="py-2.5 text-ink-300 truncate max-w-[240px]" title={entry.notes ?? undefined}>
                          {entry.notes || ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <IncomeEntryModal
          entry={editing === 'new' ? null : editing}
          earners={earners}
          entries={entries ?? []}
          defaultEarnerId={personFilter ?? earners[0].id}
          onClose={() => setEditing(null)}
        />
      )}
      {showPeople && <ManagePeopleModal earners={earners} colors={colors} onClose={() => setShowPeople(false)} />}
    </div>
  )
}

// ─── Add / edit entry ─────────────────────────────────────────────────────────

function IncomeEntryModal({ entry, earners, entries, defaultEarnerId, onClose }: {
  entry: IncomeEntry | null
  earners: Earner[]
  entries: IncomeEntry[]
  defaultEarnerId: number
  onClose: () => void
}) {
  const createEntry = useCreateIncomeEntry()
  const updateEntry = useUpdateIncomeEntry()
  const deleteEntry = useDeleteIncomeEntry()

  // A new entry usually continues at the person's latest employer, and a
  // raise usually keeps the same bonus target. `entries` is newest first.
  const latestEmployer = (earnerId: number) =>
    entries.find(e => e.earner_id === earnerId && e.employer)?.employer ?? ''
  const latestTargetPct = (earnerId: number) => {
    const pct = entries.find(e => e.earner_id === earnerId && e.kind === 'salary')?.target_bonus_pct
    return pct ? String(pct) : ''
  }
  // Annual bonuses pay out the year after they're earned.
  const defaultBonusYear = (paid: string) => (paid ? String(Number(paid.slice(0, 4)) - 1) : '')

  const [earnerId, setEarnerId] = useState(entry?.earner_id ?? defaultEarnerId)
  const [kind, setKind] = useState<IncomeKind>(entry?.kind ?? 'salary')
  const [date, setDate] = useState(entry?.effective_date ?? todayLocal())
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [employer, setEmployer] = useState(entry ? entry.employer ?? '' : latestEmployer(defaultEarnerId))
  const [employerTouched, setEmployerTouched] = useState(false)
  const [targetPct, setTargetPct] = useState(
    entry ? (entry.target_bonus_pct ? String(entry.target_bonus_pct) : '') : latestTargetPct(defaultEarnerId)
  )
  const [targetTouched, setTargetTouched] = useState(false)
  const [bonusYear, setBonusYear] = useState(
    entry?.bonus_year != null ? String(entry.bonus_year) : defaultBonusYear(entry?.effective_date ?? todayLocal())
  )
  // An existing bonus keeps its year; otherwise the year follows the paid date.
  const [bonusYearTouched, setBonusYearTouched] = useState(entry?.bonus_year != null)
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [error, setError] = useState('')

  const busy = createEntry.isPending || updateEntry.isPending || deleteEntry.isPending

  // Live target context for the form: the salary amount × % for a salary,
  // and that performance year's target for an annual bonus.
  const amountValue = amount.trim() === '' ? null : Number(amount)
  const pctValue = targetPct.trim() === '' ? null : Number(targetPct)
  const salaryTarget = amountValue != null && pctValue != null && Number.isFinite(amountValue * pctValue)
    ? amountValue * pctValue / 100
    : null
  const bonusTarget = (() => {
    const year = Number(bonusYear)
    if (kind !== 'bonus' || !Number.isInteger(year)) return null
    const yearEnd = `${year}-12-31`
    const salary = entries
      .filter(e => e.earner_id === earnerId && e.kind === 'salary' && e.id !== entry?.id && e.effective_date <= yearEnd)
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0]
    return { year, salary, target: salary ? salary.amount * (salary.target_bonus_pct ?? 0) / 100 : 0 }
  })()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = Number(amount)
    if (amount.trim() === '' || !Number.isFinite(value) || value < 0) {
      setError('Enter an amount of 0 or more.')
      return
    }
    if (!date) {
      setError('Pick a date.')
      return
    }
    if (kind === 'salary' && pctValue != null && !(Number.isFinite(pctValue) && pctValue >= 0 && pctValue <= 1000)) {
      setError('Enter a target bonus % between 0 and 1000, or leave it blank.')
      return
    }
    const year = Number(bonusYear)
    if (kind === 'bonus' && !(Number.isInteger(year) && year >= 1900 && year <= 2200)) {
      setError('Enter the performance year this bonus is for.')
      return
    }
    setError('')
    const data = {
      earner_id: earnerId,
      kind,
      effective_date: date,
      amount: value,
      employer: employer.trim() || null,
      notes: notes.trim() || null,
      target_bonus_pct: kind === 'salary' ? pctValue : null,
      bonus_year: kind === 'bonus' ? year : null,
    }
    if (entry) updateEntry.mutate({ id: entry.id, data }, { onSuccess: onClose })
    else createEntry.mutate(data, { onSuccess: onClose })
  }

  const remove = () => {
    if (!entry) return
    if (!confirm(`Delete this ${KIND_LABELS[entry.kind].toLowerCase()} entry?`)) return
    deleteEntry.mutate(entry.id, { onSuccess: onClose })
  }

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-medium text-ink-100 mb-4">{entry ? 'Edit income entry' : 'Add income entry'}</h3>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">Person</label>
            <select
              value={earnerId}
              onChange={e => {
                const id = Number(e.target.value)
                setEarnerId(id)
                if (!entry && !employerTouched) setEmployer(latestEmployer(id))
                if (!entry && !targetTouched) setTargetPct(latestTargetPct(id))
              }}
              className={INPUT_CLASS}
            >
              {earners.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label block mb-1.5">Type</label>
            <select value={kind} onChange={e => setKind(e.target.value as IncomeKind)} className={INPUT_CLASS}>
              {(Object.keys(KIND_LABELS) as IncomeKind[]).map(k => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">{kind === 'salary' ? 'Effective date' : 'Date paid'}</label>
            <input
              type="date"
              value={date}
              onChange={e => {
                setDate(e.target.value)
                if (!bonusYearTouched) setBonusYear(defaultBonusYear(e.target.value))
              }}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="label block mb-1.5">{kind === 'salary' ? 'Annual salary' : 'Gross amount'}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={kind === 'salary' ? '100000' : '5000'}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <p className="text-2xs text-ink-400 -mt-2">
          {kind === 'salary'
            ? 'Gross base pay per year, in effect from this date until the next salary change. Enter 0 if this person stopped working.'
            : kind === 'bonus'
              ? 'Gross annual performance bonus (before taxes). Counts in gross income the month it was paid, and against the target for its performance year.'
              : 'One-time gross amount (before taxes), counted in the month it was paid.'}
        </p>

        {kind === 'salary' && (
          <div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="label block mb-1.5">Target bonus %</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={targetPct}
                  onChange={e => { setTargetPct(e.target.value); setTargetTouched(true) }}
                  placeholder="None"
                  className={INPUT_CLASS}
                />
              </div>
              <div className="pb-2 text-xs text-ink-300">
                {salaryTarget != null && salaryTarget > 0 && (
                  <>= <span className="font-mono text-ink-100">{formatCurrencyWhole(salaryTarget)}</span> target bonus/yr</>
                )}
              </div>
            </div>
            <p className="text-2xs text-ink-400 mt-1.5">
              Annual bonus target as a % of base. A year's target is this % of the base in effect on Dec 31.
              Leave blank if there's no bonus plan.
            </p>
          </div>
        )}

        {kind === 'bonus' && (
          <div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="label block mb-1.5">Performance year</label>
                <input
                  type="number"
                  step="1"
                  value={bonusYear}
                  onChange={e => { setBonusYear(e.target.value); setBonusYearTouched(true) }}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
            {bonusTarget && (
              <p className="text-xs text-ink-300 mt-1.5">
                {bonusTarget.target > 0 && bonusTarget.salary ? (
                  <>
                    {bonusTarget.year} target:{' '}
                    <span className="font-mono text-ink-100">{formatCurrencyWhole(bonusTarget.target)}</span>
                    {' '}({pctLabel(bonusTarget.salary.target_bonus_pct ?? 0)} of {formatCurrencyWhole(bonusTarget.salary.amount)})
                    {amountValue != null && Number.isFinite(amountValue) && amountValue > 0 && (
                      <>
                        {' · '}
                        <span className={amountValue >= bonusTarget.target ? 'text-teal-400' : 'text-rose-400'}>
                          {formatPercent((amountValue / bonusTarget.target) * 100, 0)} of target
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-ink-400">
                    No target bonus % on {earners.find(p => p.id === earnerId)?.name ?? 'this person'}'s salary at the end
                    of {bonusTarget.year}. Add one to a salary entry to compare.
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="label block mb-1.5">Employer</label>
          <input
            value={employer}
            onChange={e => { setEmployer(e.target.value); setEmployerTouched(true) }}
            placeholder="Optional"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="label block mb-1.5">Notes</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Promotion, annual raise, new job"
            className={INPUT_CLASS}
          />
        </div>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {entry && (
            <Button type="button" variant="danger" size="sm" onClick={remove} disabled={busy}>Delete</Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={createEntry.isPending || updateEntry.isPending}
              disabled={busy}
            >
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

// ─── Manage people ────────────────────────────────────────────────────────────

function PersonName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const v = draft.trim()
    if (v && v !== value) onCommit(v)
    else setDraft(value)
  }
  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
      }}
      className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-white/[0.08] focus:border-amber-400/40 focus:bg-surface-700 rounded px-2 py-1 text-sm text-ink-100 focus:outline-none transition-colors"
    />
  )
}

function ManagePeopleModal({ earners, colors, onClose }: {
  earners: Earner[]
  colors: Map<number, string>
  onClose: () => void
}) {
  const createEarner = useCreateEarner()
  const updateEarner = useUpdateEarner()
  const deleteEarner = useDeleteEarner()
  const [newName, setNewName] = useState('')

  const add = () => {
    const name = newName.trim()
    if (!name) return
    createEarner.mutate({ name, sort_order: earners.length }, { onSuccess: () => setNewName('') })
  }

  const remove = (e: Earner) => {
    if (!confirm(`Delete ${e.name} and all of their income entries?`)) return
    deleteEarner.mutate(e.id)
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-ink-100 mb-1">People</h2>
      <p className="text-xs text-ink-400 mb-4">
        Everyone in the household whose gross income you want to track.
      </p>

      {earners.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-surface-800/50 divide-y divide-white/[0.04] mb-4">
          {earners.map(e => (
            <div key={e.id} className="flex items-center gap-2 px-2 py-1.5">
              <PersonName value={e.name} onCommit={name => updateEarner.mutate({ id: e.id, data: { name } })} />
              <div className="flex items-center gap-1" role="radiogroup" aria-label={`${e.name} color`}>
                {EARNER_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={colors.get(e.id) === c}
                    aria-label={`Color ${c}`}
                    onClick={() => updateEarner.mutate({ id: e.id, data: { color: c } })}
                    className={clsx(
                      'w-4 h-4 rounded-full transition-shadow',
                      colors.get(e.id) === c ? 'ring-2 ring-offset-2 ring-offset-surface-800 ring-ink-200' : 'opacity-60 hover:opacity-100'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => remove(e)}
                title="Delete"
                className="p-1 rounded text-rose-400 hover:bg-white/[0.06]"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Name, e.g. Me or Sarah"
          className="flex-1 min-w-0 bg-surface-700 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
          autoFocus
        />
        <Button size="sm" onClick={add} loading={createEarner.isPending} disabled={!newName.trim()}>Add</Button>
      </div>
    </Modal>
  )
}
