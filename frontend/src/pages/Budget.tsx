import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import {
  useBudgets, useCategories, useBulkCreateBudgets, useAutoSaveBudgets, useCopyBudgetMonth,
  useDemoStatus, useBudgetVisibleCategories, useSetBudgetVisibleCategories, useSpendingAverages,
} from '@/hooks'
import { Card, PageHeader, Button, Spinner, Modal } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencySignedWhole, currentYearMonth, sortBySortOrder } from '@/lib/format'
import type { Category, BudgetCreate, SpendingAverageLine } from '@/types'
import clsx from 'clsx'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

// Categories checked by default when demo data is active
const DEMO_DEFAULT_VISIBLE = new Set([
  'Salary & Wages',
  'Rent/Mortgage',
  'Groceries',
  'Car Insurance',
  'Restaurants',
  'Entertainment',
])

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getPreviousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

// ── Row model for the budget table ───────────────────────────────────────────

interface Avgs { avg1: number; avg3: number; avg6: number; avg12: number }

interface BudgetRow extends Avgs {
  key: string
  categoryId?: number        // undefined for aggregate "Other" rows
  name: string
  isIncome: boolean
  parentName?: string
  editable: boolean          // false for aggregate rows (can't set a single budget)
}

interface Section {
  groupName: string
  rows: BudgetRow[]
}

function emptyAvgs(): Avgs {
  return { avg1: 0, avg3: 0, avg6: 0, avg12: 0 }
}

// A single average cell — respects the $ / +/- toggle and colors good vs. bad.
function AvgCell({
  budget, avg, isIncome, showDiff, plain,
}: { budget: number; avg: number; isIncome: boolean; showDiff: boolean; plain?: boolean }) {
  // Aggregate ("Other") rows have no budget of their own — always show the raw avg.
  if (plain) {
    return <span className="text-ink-400">{avg > 0 ? formatCurrencyWhole(avg) : '—'}</span>
  }

  if (showDiff) {
    const diff = budget - avg
    // Expense: budgeting at/above avg is good. Income: budgeting at/below avg is good.
    const good = isIncome ? diff <= 0 : diff >= 0
    const color = Math.abs(diff) < 0.5 ? 'text-ink-300' : good ? 'text-ink-300' : 'text-rose-400'
    return <span className={color}>{formatCurrencySignedWhole(diff)}</span>
  }

  const hasBudget = budget > 0
  const good = isIncome ? budget <= avg : budget >= avg
  const color = !hasBudget ? 'text-ink-300' : good ? 'text-ink-300' : 'text-rose-400'
  return <span className={color}>{avg > 0 ? formatCurrencyWhole(avg) : '—'}</span>
}

// ── Copy budget between months (unchanged behavior) ──────────────────────────

function CopyBudgetModal({
  fromYear, fromMonth, sourceVisible, onClose,
}: {
  fromYear: number
  fromMonth: number
  sourceVisible: Set<number>
  onClose: () => void
}) {
  const copyBudgetMonth = useCopyBudgetMonth()
  const setVisibleCategories = useSetBudgetVisibleCategories()
  const [targetYear, setTargetYear] = useState(fromYear)
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())

  const toggleMonth = (m: number) => {
    setSelectedMonths(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  const selectableMonths = MONTHS.map((name, idx) => ({
    month: idx + 1,
    name,
    disabled: targetYear === fromYear && idx + 1 === fromMonth,
  }))

  const handleCopy = async (e: React.FormEvent) => {
    e.preventDefault()
    const targets = [...selectedMonths]
      .filter(m => !(targetYear === fromYear && m === fromMonth))
      .sort((a, b) => a - b)

    if (targets.length === 0) return

    for (const toMonth of targets) {
      await copyBudgetMonth.mutateAsync({
        from_year: fromYear,
        from_month: fromMonth,
        to_year: targetYear,
        to_month: toMonth,
        overwrite: true,
      })
      await setVisibleCategories.mutateAsync({
        year: targetYear,
        month: toMonth,
        category_ids: [...sourceVisible],
      })
    }

    onClose()
  }

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Copy Budget Configuration</h2>
      <p className="text-sm text-ink-300 mb-4">
        From {MONTHS[fromMonth - 1]} {fromYear}
      </p>

      <form onSubmit={handleCopy} className="space-y-4">
        <div>
          <label className="label block mb-1.5">Target Year</label>
          <select
            value={targetYear}
            onChange={e => setTargetYear(Number(e.target.value))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none"
          >
            {[2023, 2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div>
          <label className="label block mb-2">Target Month(s)</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {selectableMonths.map(m => (
              <label
                key={m.month}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm',
                  m.disabled ? 'border-white/[0.06] text-ink-400 opacity-40' : 'border-white/[0.08] text-ink-200'
                )}
              >
                <input
                  type="checkbox"
                  disabled={m.disabled}
                  checked={selectedMonths.has(m.month)}
                  onChange={() => toggleMonth(m.month)}
                  className="accent-amber-400"
                />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        </div>

        <p className="text-2xs text-ink-400">
          Copies budget amounts and selected budget categories. Existing target-month budget values are overwritten.
        </p>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            loading={copyBudgetMonth.isPending}
            className="flex-1"
            disabled={selectedMonths.size === 0}
          >
            Copy Budget
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// Horizontal scroll distance over which the frozen "Category" column collapses.
const STICKY_COL_COLLAPSE_DISTANCE = 32

// A bold total row: label + budget + the four average columns.
function TotalRow({
  label, t, basePad, className,
}: { label: string; t: Avgs & { budget: number }; basePad: number; className?: string }) {
  return (
    <tr className={clsx('font-mono font-semibold', className)}>
      <td
        className="sticky left-0 z-10 bg-surface-800 py-2 text-xs uppercase tracking-wide text-ink-200"
        style={{ paddingLeft: basePad, paddingRight: basePad }}
      >{label}</td>
      <td className="py-2 px-2 text-right text-sm text-ink-100">{formatCurrencyWhole(t.budget)}</td>
      <td className="py-2 px-2 text-right text-sm text-ink-100">{formatCurrencyWhole(t.avg1)}</td>
      <td className="py-2 px-2 text-right text-sm text-ink-100">{formatCurrencyWhole(t.avg3)}</td>
      <td className="py-2 px-2 text-right text-sm text-ink-100">{formatCurrencyWhole(t.avg6)}</td>
      <td className="py-2 px-2 text-right text-sm text-ink-100">{formatCurrencyWhole(t.avg12)}</td>
    </tr>
  )
}

export default function BudgetPage() {
  const now = currentYearMonth()
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [showCopy, setShowCopy] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [visibleCategories, setVisibleCategories] = useState<Set<number>>(new Set())
  const [autoCarryDone, setAutoCarryDone] = useState<Set<string>>(new Set())
  const [visibilityInitDone, setVisibilityInitDone] = useState<Set<string>>(new Set())

  // Local budget input text: category_id -> string. Synced from server, edited inline.
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [focusedCat, setFocusedCat] = useState<number | null>(null)
  const [savedCat, setSavedCat] = useState<number | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: categories } = useCategories()
  const { data: budgets } = useBudgets({ year, month })
  const { data: averages, isLoading } = useSpendingAverages(year, month)
  const previousMonth = getPreviousMonth(year, month)
  const { data: previousBudgets } = useBudgets({ year: previousMonth.year, month: previousMonth.month })
  const { data: demoStatus } = useDemoStatus()
  const bulkCreateBudgets = useBulkCreateBudgets()
  const autoSaveBudgets = useAutoSaveBudgets()
  const setBudgetVisibleCategories = useSetBudgetVisibleCategories()
  const isDemo = !!demoStatus?.has_demo_data
  const visibility = useBudgetVisibleCategories(year, month, !isDemo && demoStatus !== undefined)
  const previousVisibility = useBudgetVisibleCategories(previousMonth.year, previousMonth.month, !isDemo && demoStatus !== undefined)

  // ── Frozen category column + floating header (mirrors the Spending report) ───
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const floatingHeaderRef = useRef<HTMLDivElement>(null)
  const [showFloatingHeader, setShowFloatingHeader] = useState(false)
  const [colCollapse, setColCollapse] = useState(0)

  // Show a fixed duplicate header once the real one scrolls up behind the page header.
  useEffect(() => {
    const thead = theadRef.current
    if (!thead) return
    const scrollParent = thead.closest('main')
    if (!scrollParent) return
    const check = () => {
      const headerH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--page-header-height') || '0'
      )
      setShowFloatingHeader(thead.getBoundingClientRect().top < headerH)
    }
    scrollParent.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    check()
    return () => {
      scrollParent.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [isLoading, averages])

  // Sync the floating header's horizontal scroll + collapse the frozen column.
  const onTableScroll = useCallback(() => {
    if (tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
    const p = Math.min(1, (tableWrapperRef.current?.scrollLeft ?? 0) / STICKY_COL_COLLAPSE_DISTANCE)
    setColCollapse(prev => (prev === p ? prev : p))
  }, [])

  useEffect(() => {
    if (showFloatingHeader && tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
  }, [showFloatingHeader])

  // Frozen "Category" column geometry, interpolated by scroll-collapse progress (0..1).
  const catColWidth = Math.round(180 - 40 * colCollapse) // 180 → 140
  const catBasePad = Math.round(16 - 8 * colCollapse)    // 16 → 8
  const catTableMinWidth = catColWidth + 96 + 72 * 4     // budget col + four avg cols

  // ── Visible-category sync (demo default / server / carry-from-previous) ──────
  useEffect(() => {
    if (!categories || demoStatus === undefined) return
    const flatten = (cats: Category[]): Category[] =>
      cats.flatMap(c => c.children.length > 0 ? flatten(c.children) : [c])
    const leaves = flatten(categories)

    if (demoStatus.has_demo_data) {
      const ids = new Set<number>(leaves.filter(l => DEMO_DEFAULT_VISIBLE.has(l.name)).map(l => l.id))
      setVisibleCategories(ids)
      return
    }

    const key = monthKey(year, month)
    const serverIds = visibility.data?.category_ids

    if (Array.isArray(serverIds)) {
      setVisibleCategories(new Set<number>(serverIds))
      return
    }

    if (serverIds === null) {
      if (visibilityInitDone.has(key)) return
      setVisibilityInitDone(prev => new Set(prev).add(key))

      const prevIds = previousVisibility.data?.category_ids
      const ids = Array.isArray(prevIds) && prevIds.length > 0
        ? new Set<number>(prevIds)
        : new Set<number>(leaves.map(l => l.id))

      setVisibleCategories(ids)
      setBudgetVisibleCategories.mutate({ year, month, category_ids: [...ids] })
    }
  }, [categories, demoStatus, year, month, visibility.data?.category_ids, previousVisibility.data?.category_ids, visibilityInitDone, setBudgetVisibleCategories])

  const handleToggleVisible = useCallback((catId: number) => {
    const next = new Set(visibleCategories)
    if (next.has(catId)) next.delete(catId)
    else next.add(catId)
    setVisibleCategories(next)
    if (!demoStatus?.has_demo_data) {
      setBudgetVisibleCategories.mutate({ year, month, category_ids: [...next] })
    }
  }, [visibleCategories, demoStatus, setBudgetVisibleCategories, year, month])

  // ── Auto-carry budget values into the new current month from the previous ────
  useEffect(() => {
    if (!demoStatus || demoStatus.has_demo_data) return
    if (!budgets || !previousBudgets) return
    if (year !== now.year || month !== now.month) return

    const key = monthKey(year, month)
    if (autoCarryDone.has(key)) return

    if (budgets.length > 0 || previousBudgets.length === 0) {
      setAutoCarryDone(prev => new Set(prev).add(key))
      return
    }

    // Mark done up-front (like visibilityInitDone above) so re-renders from the
    // mutation's own pending-state change don't re-enter and fire it again.
    setAutoCarryDone(prev => new Set(prev).add(key))

    const payload: BudgetCreate[] = previousBudgets.map(b => ({
      category_id: b.category_id, year, month, amount: b.amount, notes: b.notes,
    }))
    bulkCreateBudgets.mutate(payload)
  }, [demoStatus, budgets, previousBudgets, year, month, now.year, now.month, autoCarryDone, bulkCreateBudgets])

  // ── Sync budget inputs from server (preserving the field being edited) ───────
  useEffect(() => {
    const map: Record<number, string> = {}
    if (budgets) {
      for (const b of budgets) {
        if (b.amount > 0) map[b.category_id] = String(b.amount)
      }
    }
    setAmounts(prev => {
      if (focusedCat != null && prev[focusedCat] !== undefined) {
        map[focusedCat] = prev[focusedCat]
      }
      return map
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgets, year, month])

  const serverBudgetByCat = useMemo(() => {
    const m = new Map<number, number>()
    if (budgets) for (const b of budgets) m.set(b.category_id, b.amount)
    return m
  }, [budgets])

  const avgByCat = useMemo(() => {
    const m = new Map<number, SpendingAverageLine>()
    if (averages) {
      for (const line of [...averages.income_lines, ...averages.expense_lines]) {
        if (line.category_id != null) m.set(line.category_id, line)
      }
    }
    return m
  }, [averages])

  const toggleSection = (groupName: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const handleBudgetChange = (catId: number, value: string) => {
    setAmounts(prev => ({ ...prev, [catId]: value }))
  }

  const handleBudgetBlur = (catId: number) => {
    setFocusedCat(null)
    const parsed = parseFloat(amounts[catId] ?? '')
    const amount = isNaN(parsed) ? 0 : Math.max(0, parsed)
    const serverVal = serverBudgetByCat.get(catId) ?? 0
    if (amount === serverVal) return
    autoSaveBudgets.mutate([{ category_id: catId, year, month, amount }], {
      onSuccess: () => {
        setSavedCat(catId)
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSavedCat(c => (c === catId ? null : c)), 1500)
      },
    })
  }

  // ── Build grouped sections from visible categories + "Other" aggregates ──────
  const sections = useMemo<Section[]>(() => {
    if (!categories) return []

    const parents = sortBySortOrder(categories.filter(c => c.children.length > 0))

    const grouped = new Map<string, BudgetRow[]>()
    parents.forEach(p => grouped.set(p.name, []))

    const unbudgetedIncome = emptyAvgs()
    const unbudgetedExpense = emptyAvgs()

    const addAvgs = (bucket: Avgs, line?: SpendingAverageLine) => {
      if (!line) return
      bucket.avg1 += line.avg_1m; bucket.avg3 += line.avg_3m
      bucket.avg6 += line.avg_6m; bucket.avg12 += line.avg_12m
    }

    // Uncategorized spend (backend category_id == null) never appears as a real
    // row — fold it into the Unbudgeted rollups so the table reconciles with the
    // all-category grand totals below.
    if (averages) {
      addAvgs(unbudgetedIncome, averages.income_lines.find(l => l.category_id == null))
      addAvgs(unbudgetedExpense, averages.expense_lines.find(l => l.category_id == null))
    }

    for (const parent of parents) {
      for (const child of sortBySortOrder(parent.children)) {
        if (child.name.toLowerCase() === 'uncategorized') continue
        const line = avgByCat.get(child.id)

        // Unchecked categories roll into a single non-editable "Unbudgeted" row so
        // their spend stays visible; every checked category — including the real
        // "Other Income"/"Other Expense" — is an ordinary budgetable row.
        if (!visibleCategories.has(child.id)) {
          addAvgs(child.is_income ? unbudgetedIncome : unbudgetedExpense, line)
          continue
        }

        grouped.get(parent.name)?.push({
          key: String(child.id),
          categoryId: child.id,
          name: child.name,
          isIncome: child.is_income,
          parentName: parent.name,
          editable: true,
          avg1: line?.avg_1m ?? 0, avg3: line?.avg_3m ?? 0,
          avg6: line?.avg_6m ?? 0, avg12: line?.avg_12m ?? 0,
        })
      }
    }

    const hasVals = (a: Avgs) => a.avg1 !== 0 || a.avg3 !== 0 || a.avg6 !== 0 || a.avg12 !== 0
    // Rollup of everything left out of the budget — shown but not editable.
    if (hasVals(unbudgetedIncome)) {
      grouped.get('Income')?.push({
        key: 'unbudgeted-income', name: 'Unbudgeted', isIncome: true, editable: false, ...unbudgetedIncome,
      })
    }
    if (hasVals(unbudgetedExpense)) {
      grouped.get('Other')?.push({
        key: 'unbudgeted-expenses', name: 'Unbudgeted', isIncome: false, editable: false, ...unbudgetedExpense,
      })
    }

    return parents
      .map(parent => ({ groupName: parent.name, rows: grouped.get(parent.name) ?? [] }))
      .filter(s => s.rows.length > 0)
  }, [categories, avgByCat, visibleCategories, averages])

  // ── Every leaf category, grouped — used by the "select categories" mode ──────
  // Independent of visibleCategories so toggling a checkbox doesn't rebuild it;
  // the checked state is read from visibleCategories at render time.
  const selectSections = useMemo<Section[]>(() => {
    if (!categories) return []

    const parents = sortBySortOrder(categories.filter(c => c.children.length > 0))

    const grouped = new Map<string, BudgetRow[]>()
    parents.forEach(p => grouped.set(p.name, []))

    for (const parent of parents) {
      for (const child of sortBySortOrder(parent.children)) {
        if (child.name.toLowerCase() === 'uncategorized') continue
        const line = avgByCat.get(child.id)
        grouped.get(parent.name)?.push({
          key: String(child.id),
          categoryId: child.id,
          name: child.name,
          isIncome: child.is_income,
          parentName: parent.name,
          editable: true,
          avg1: line?.avg_1m ?? 0, avg3: line?.avg_3m ?? 0,
          avg6: line?.avg_6m ?? 0, avg12: line?.avg_12m ?? 0,
        })
      }
    }

    return parents
      .map(parent => ({ groupName: parent.name, rows: grouped.get(parent.name) ?? [] }))
      .filter(s => s.rows.length > 0)
  }, [categories, avgByCat])

  // ── Grand totals: budget and averages, scoped to the same editable rows shown in
  //    the table so the summary cards, the total rows, and each column all agree.
  const grandTotals = useMemo(() => {
    // Budget amounts are scoped to the categories the user actually budgeted.
    const income: Avgs & { budget: number } = { budget: 0, ...emptyAvgs() }
    const expense: Avgs & { budget: number } = { budget: 0, ...emptyAvgs() }
    for (const section of sections) {
      for (const r of section.rows) {
        if (!r.editable || r.categoryId == null) continue  // skip "Other" aggregate rows
        const t = r.isIncome ? income : expense
        t.budget += parseFloat(amounts[r.categoryId] ?? '') || 0
      }
    }
    // Averages use the backend all-category totals so the Total rows match the
    // Spending report and Dashboard (which also count every category).
    income.avg1 = averages?.total_income_avg_1m ?? 0
    income.avg3 = averages?.total_income_avg_3m ?? 0
    income.avg6 = averages?.total_income_avg_6m ?? 0
    income.avg12 = averages?.total_income_avg_12m ?? 0
    expense.avg1 = averages?.total_expense_avg_1m ?? 0
    expense.avg3 = averages?.total_expense_avg_3m ?? 0
    expense.avg6 = averages?.total_expense_avg_6m ?? 0
    expense.avg12 = averages?.total_expense_avg_12m ?? 0
    const net = {
      budget: income.budget - expense.budget,
      avg1: income.avg1 - expense.avg1, avg3: income.avg3 - expense.avg3,
      avg6: income.avg6 - expense.avg6, avg12: income.avg12 - expense.avg12,
    }
    return { income, expense, net }
  }, [sections, amounts, averages])

  const summaryTiles = averages ? [
    { label: 'Budgeted Income', budget: grandTotals.income.budget, isIncome: true },
    { label: 'Budgeted Expenses', budget: grandTotals.expense.budget, isIncome: false },
    { label: 'Net', budget: grandTotals.net.budget, isIncome: true },
  ] : []

  const monthSelector = (className: string) => (
    <select
      value={`${year}-${month}`}
      onChange={e => {
        const [y, m] = e.target.value.split('-').map(Number)
        setYear(y); setMonth(m)
      }}
      className={clsx('bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none', className)}
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
  )

  return (
    <div className="space-y-5 animate-slide-up">
      <PageHeader
        title="Budget"
        action={
          <div className="flex items-center gap-2">
            {monthSelector('hidden md:block')}
            <Button variant="secondary" size="sm" onClick={() => setShowCopy(true)}>Copy Budget</Button>
          </div>
        }
        extra={<div className="mt-3 flex justify-end md:hidden">{monthSelector('')}</div>}
      />

      {isLoading || !averages ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Compact summary: budgeted totals vs. recent averages.
              Mobile: 2 tiles on top, Net centered below (matches Cash Flow). */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {summaryTiles.map((t, i) => (
              <div key={t.label} className={clsx(i === 2 && 'col-span-2 md:col-span-1 flex justify-center')}>
                <Card className={clsx('flex flex-col gap-1 w-full', i === 2 && 'max-md:w-1/2')}>
                  <span className="label">{t.label}</span>
                  <span className={clsx(
                    'stat-value',
                    t.label === 'Net'
                      ? (t.budget >= 0 ? 'value-positive' : 'value-negative')
                      : 'value-neutral',
                  )}>
                    {formatCurrencyWhole(t.budget)}
                  </span>
                </Card>
              </div>
            ))}
          </div>

          {/* Toolbar: select-categories toggle + collapse/expand + $ / +/- toggle */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant={selectMode ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelectMode(v => !v)}
              >
                {selectMode ? 'Done selecting' : 'Select budget categories'}
              </Button>
              <button
                onClick={() => setCollapsedSections(new Set())}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200 transition-colors"
              >
                Expand All
              </button>
              <button
                onClick={() => setCollapsedSections(new Set((selectMode ? selectSections : sections).map(s => s.groupName)))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200 transition-colors"
              >
                Collapse All
              </button>
            </div>
            {!selectMode && (
              <div className="inline-flex rounded-lg border border-white/[0.08] overflow-hidden text-xs">
                <button
                  onClick={() => setShowDiff(false)}
                  className={clsx('px-3 py-1.5', !showDiff ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
                >$</button>
                <button
                  onClick={() => setShowDiff(true)}
                  className={clsx('px-3 py-1.5', showDiff ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
                >+/−</button>
              </div>
            )}
          </div>

          {selectMode && (
            <p className="text-2xs text-ink-400 -mt-2">
              Check the categories to budget for this month. Averages show recent spend to help you decide;
              unchecked categories roll into “Other”.
            </p>
          )}

          <Card padding={false}>
            {/* Floating header — a fixed duplicate that appears once the real
                header scrolls up behind the page title bar (mirrors Spending). */}
            {showFloatingHeader && (() => {
              const rect = tableWrapperRef.current?.getBoundingClientRect()
              return (
                <div
                  className="fixed z-20 bg-surface-800 border-b border-white/[0.06] shadow-lg"
                  style={{ top: 'calc(var(--page-header-height, 0px) - 1px)', left: rect?.left ?? 0, width: rect?.width ?? '100%' }}
                >
                  <div ref={floatingHeaderRef} className="overflow-hidden">
                    <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth, borderCollapse: 'collapse' }}>
                      <colgroup>
                        <col style={{ width: catColWidth }} />
                        <col style={{ width: 96 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                      </colgroup>
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-ink-300">
                          <th className="text-left font-medium py-3 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                          <th className="text-right font-medium px-2 py-3">Budget</th>
                          <th className="text-right font-medium px-2 py-3">1M</th>
                          <th className="text-right font-medium px-2 py-3">3M</th>
                          <th className="text-right font-medium px-2 py-3">6M</th>
                          <th className="text-right font-medium px-2 py-3">12M</th>
                        </tr>
                      </thead>
                    </table>
                  </div>
                </div>
              )
            })()}

            <div className="overflow-x-auto" ref={tableWrapperRef} onScroll={onTableScroll}>
              <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth, borderCollapse: 'collapse' }}>
                <colgroup>
                  <col style={{ width: catColWidth }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 72 }} />
                </colgroup>
                <thead ref={theadRef}>
                  <tr className="border-b border-white/[0.06] text-xs uppercase tracking-wide text-ink-300">
                    <th className="text-left font-medium py-3 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                    <th className="text-right font-medium px-2 py-3">Budget</th>
                    <th className="text-right font-medium px-2 py-3">1M</th>
                    <th className="text-right font-medium px-2 py-3">3M</th>
                    <th className="text-right font-medium px-2 py-3">6M</th>
                    <th className="text-right font-medium px-2 py-3">12M</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Net total (income − expenses) pinned to the top of the table */}
                  {!selectMode && (
                    <TotalRow label="Net" t={grandTotals.net} basePad={catBasePad} />
                  )}

                  {(selectMode ? selectSections : sections).map((section, i, arr) => {
                    const isIncomeGroup = section.groupName === 'Income'
                    // The first expense section (right after Income) gets a heavier
                    // divider so the income block reads as clearly separate.
                    const isFirstExpense = !isIncomeGroup && arr[i - 1]?.groupName === 'Income'
                    const subtotal = section.rows.reduce((acc, r) => {
                      const b = r.editable && r.categoryId != null ? (parseFloat(amounts[r.categoryId] ?? '') || 0) : 0
                      acc.budget += b
                      acc.avg1 += r.avg1; acc.avg3 += r.avg3; acc.avg6 += r.avg6; acc.avg12 += r.avg12
                      return acc
                    }, { budget: 0, avg1: 0, avg3: 0, avg6: 0, avg12: 0 })

                    const collapsed = collapsedSections.has(section.groupName)

                    return (
                      <Fragment key={section.groupName}>
                        {/* Group header — the label lives in a real first-column
                            sticky cell so it stays frozen to the left while the
                            table scrolls right (a full-width colSpan cell can't
                            stick). The whole row toggles collapse. */}
                        <tr
                          onClick={() => toggleSection(section.groupName)}
                          className={clsx(
                            'group cursor-pointer',
                            isIncomeGroup && 'bg-teal-500/[0.03]',
                            (isIncomeGroup || isFirstExpense) ? 'border-t-2 border-white/[0.12]' : 'border-t border-white/[0.06]',
                          )}
                        >
                          <td className="sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>
                            <div className="flex items-center gap-2 py-2 text-left">
                              <svg
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                className={clsx('w-3 h-3 flex-shrink-0 text-ink-400 transition-transform duration-150', collapsed && '-rotate-90')}
                              >
                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                              </svg>
                              <div className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', isIncomeGroup ? 'bg-teal-400' : 'bg-rose-400')} />
                              <h3 className="text-xs font-semibold text-ink-200 group-hover:text-ink-100 truncate">{section.groupName}</h3>
                            </div>
                          </td>
                          <td colSpan={5} />
                        </tr>

                        {!collapsed && section.rows.map(row => {
                          const budgetVal = row.categoryId != null ? (parseFloat(amounts[row.categoryId] ?? '') || 0) : 0

                          // Selection mode: checkbox + name, current budget, and raw averages.
                          if (selectMode && row.categoryId != null) {
                            const checked = visibleCategories.has(row.categoryId)
                            return (
                              <tr
                                key={row.key}
                                onClick={() => handleToggleVisible(row.categoryId!)}
                                className="border-b border-white/[0.03] cursor-pointer"
                              >
                                <td className="py-1.5 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {}}
                                      className="accent-amber-400 flex-shrink-0 pointer-events-none"
                                    />
                                    <span className={clsx('text-sm truncate', checked ? 'text-ink-100' : 'text-ink-400')}>{row.name}</span>
                                  </div>
                                </td>
                                <td className="py-1.5 px-2 text-right text-xs font-mono text-ink-500">{budgetVal > 0 ? formatCurrencyWhole(budgetVal) : '—'}</td>
                                <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={0} avg={row.avg1} isIncome={row.isIncome} showDiff={false} plain /></td>
                                <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={0} avg={row.avg3} isIncome={row.isIncome} showDiff={false} plain /></td>
                                <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={0} avg={row.avg6} isIncome={row.isIncome} showDiff={false} plain /></td>
                                <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={0} avg={row.avg12} isIncome={row.isIncome} showDiff={false} plain /></td>
                              </tr>
                            )
                          }

                          return (
                            <tr key={row.key} className="border-b border-white/[0.03]">
                              <td className="py-1.5 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-sm text-ink-100 truncate">{row.name}</span>
                                  {savedCat === row.categoryId && (
                                    <span className="text-2xs text-teal-400 flex-shrink-0">✓</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2">
                                {row.editable && row.categoryId != null ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="—"
                                    value={amounts[row.categoryId] ?? ''}
                                    onFocus={() => setFocusedCat(row.categoryId!)}
                                    onChange={e => handleBudgetChange(row.categoryId!, e.target.value)}
                                    onBlur={() => handleBudgetBlur(row.categoryId!)}
                                    onWheel={e => (e.target as HTMLInputElement).blur()}
                                    className="w-full bg-surface-700 border border-white/[0.08] rounded-md px-2 py-1 text-sm font-mono text-ink-100 text-right focus:outline-none focus:border-amber-400/40 transition-colors"
                                  />
                                ) : (
                                  <span className="block text-right text-2xs text-ink-500 italic">—</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={budgetVal} avg={row.avg1} isIncome={row.isIncome} showDiff={showDiff} plain={!row.editable} /></td>
                              <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={budgetVal} avg={row.avg3} isIncome={row.isIncome} showDiff={showDiff} plain={!row.editable} /></td>
                              <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={budgetVal} avg={row.avg6} isIncome={row.isIncome} showDiff={showDiff} plain={!row.editable} /></td>
                              <td className="py-1.5 px-2 text-right text-sm font-mono"><AvgCell budget={budgetVal} avg={row.avg12} isIncome={row.isIncome} showDiff={showDiff} plain={!row.editable} /></td>
                            </tr>
                          )
                        })}

                        {/* Income is a single section, so its subtotal is the grand
                            Total Income row; expense sections keep a plain subtotal. */}
                        {!selectMode && (isIncomeGroup ? (
                          <TotalRow label="Total Income" t={grandTotals.income} basePad={catBasePad} />
                        ) : (
                          <tr className="text-xs font-mono text-ink-300">
                            <td className="pt-1.5 pb-0.5 sticky left-0 z-10 bg-surface-800 uppercase tracking-wide" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Subtotal</td>
                            <td className="pt-1.5 pb-0.5 px-2 text-right text-ink-100">{formatCurrencyWhole(subtotal.budget)}</td>
                            <td className="pt-1.5 pb-0.5 px-2 text-right">{formatCurrencyWhole(subtotal.avg1)}</td>
                            <td className="pt-1.5 pb-0.5 px-2 text-right">{formatCurrencyWhole(subtotal.avg3)}</td>
                            <td className="pt-1.5 pb-0.5 px-2 text-right">{formatCurrencyWhole(subtotal.avg6)}</td>
                            <td className="pt-1.5 pb-0.5 px-2 text-right">{formatCurrencyWhole(subtotal.avg12)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}

                  {/* Total expenses pinned to the bottom of the table */}
                  {!selectMode && (
                    <TotalRow label="Total Expenses" t={grandTotals.expense} basePad={catBasePad} className="border-t-2 border-white/[0.12]" />
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {showCopy && (
        <CopyBudgetModal
          fromYear={year}
          fromMonth={month}
          sourceVisible={visibleCategories}
          onClose={() => setShowCopy(false)}
        />
      )}
    </div>
  )
}
