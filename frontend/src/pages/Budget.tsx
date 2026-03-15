import { useState, useMemo, useEffect, useCallback } from 'react'
import { useBudgetReport, useBudgets, useCategories, useBulkCreateBudgets, useCopyBudgetMonth, useDemoStatus, useBudgetVisibleCategories, useSetBudgetVisibleCategories } from '@/hooks'
import { Card, PageHeader, Button, BudgetBar, StatCard, Spinner, Modal } from '@/components/ui'
import { formatCurrency, formatCurrencyWhole, currentYearMonth } from '@/lib/format'
import type { BudgetLineItem, Category, BudgetCreate } from '@/types'
import clsx from 'clsx'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

// Order for parent category groups
const GROUP_ORDER = ['Income', 'Essential', 'Utilities', 'Lifestyle', 'Financial', 'Other']

const ESSENTIAL_CATEGORY_ORDER = [
  'Rent/Mortgage',
  'Property Tax',
  'HOA',
  'Home Maintenance & Repairs',
  'Home Insurance',
  'Car Insurance',
  'Other Insurance',
  'Groceries',
]

function sortCategoryChildren(parentName: string, children: Category[]): Category[] {
  if (parentName !== 'Essential') return children
  const filtered = children.filter(c => c.name !== 'Life Insurance')
  return [...filtered].sort((a, b) => {
    const aIdx = ESSENTIAL_CATEGORY_ORDER.indexOf(a.name)
    const bIdx = ESSENTIAL_CATEGORY_ORDER.indexOf(b.name)
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
  })
}


// Categories checked by default when demo data is active
const DEMO_DEFAULT_VISIBLE = new Set([
  'Salary & Wages',
  'Rent/Mortgage',
  'Groceries',
  'Car Insurance',
  'Restaurants',
  'Entertainment',
])

// localStorage key prefix for visible categories (stored per month)
const VISIBLE_CATEGORIES_KEY_PREFIX = 'forge-budget-visible-categories'
const LEGACY_VISIBLE_CATEGORIES_KEY = 'forge-budget-visible-categories'

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function getPreviousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

function loadVisibleCategories(year: number, month: number): Set<number> | null {
  try {
    const stored = localStorage.getItem(`${VISIBLE_CATEGORIES_KEY_PREFIX}-${monthKey(year, month)}`)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
    const legacyStored = localStorage.getItem(LEGACY_VISIBLE_CATEGORIES_KEY)
    if (legacyStored) {
      return new Set(JSON.parse(legacyStored))
    }
  } catch {}
  return null // Return null to indicate no stored value (vs empty set)
}

function saveVisibleCategories(year: number, month: number, ids: Set<number>) {
  localStorage.setItem(`${VISIBLE_CATEGORIES_KEY_PREFIX}-${monthKey(year, month)}`, JSON.stringify([...ids]))
}
function BudgetLineRow({ line, onClick }: { line: BudgetLineItem; onClick?: () => void }) {
  const isOver = line.remaining < 0
  const hasNoBudget = line.budgeted === 0
  const isClickable = !!onClick && !!line.category_id

  // For income: over budget is good (green), under is bad (red)
  // For expenses: over budget is bad (red), under is good (green)
  const isGood = line.is_income ? isOver : !isOver
  const statusColor = isGood ? 'text-teal-400' : 'text-rose-400'
  const labelColor = isGood ? 'text-ink-400' : 'text-rose-400'

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={clsx(
        'flex items-center gap-4 py-3 border-b border-white/[0.04] last:border-0 px-5 -mx-5',
        isClickable && 'cursor-pointer hover:bg-white/[0.02] transition-colors'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm text-ink-100">{line.category_name}</span>
          <span className="text-2xs text-ink-400 font-mono ml-auto">
            {line.transaction_count} txn{line.transaction_count !== 1 ? 's' : ''}
          </span>
        </div>
        {!hasNoBudget && (
          <BudgetBar
            label=""
            actual={line.actual}
            budgeted={line.budgeted}
            percentUsed={line.percent_used}
            invertColors={line.is_income}
          />
        )}
      </div>
      <div className="text-right flex-shrink-0 min-w-28">
        {!hasNoBudget ? (
          <>
            <div className={clsx('font-mono text-sm', statusColor)}>
              {isOver ? '-' : '+'}{formatCurrencyWhole(Math.abs(line.remaining))}
            </div>
            <div className={clsx('text-2xs mt-0.5', labelColor)}>
              {isOver ? 'over budget' : 'remaining'}
            </div>
          </>
        ) : (
          <>
            <div className="font-mono text-sm text-ink-100">
              {formatCurrencyWhole(line.actual)}
            </div>
            <div className="text-2xs text-ink-400 mt-0.5">no budget set</div>
          </>
        )}
      </div>
    </div>
  )
}

function SetBudgetModal({ line, year, month, onClose }: {
  line: BudgetLineItem
  year: number
  month: number
  onClose: () => void
}) {
  const bulkCreate = useBulkCreateBudgets()
  const [amount, setAmount] = useState(line.budgeted > 0 ? String(line.budgeted) : '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!line.category_id) return

    const value = parseFloat(amount)
    if (!isNaN(value) && value >= 0) {
      await bulkCreate.mutateAsync([{ category_id: line.category_id, year, month, amount: value }])
    }
    onClose()
  }

  return (
    <Modal onClose={onClose} className="max-w-sm">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Set Budget</h2>
      <p className="text-sm text-ink-300 mb-4">{line.category_name}</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label block mb-1.5">Budget Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            autoFocus
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onWheel={e => (e.target as HTMLInputElement).blur()}
            placeholder="0.00"
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          />
          <p className="text-2xs text-ink-400 mt-1">
            Current spending: {formatCurrency(line.actual)}
          </p>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" loading={bulkCreate.isPending} className="flex-1">Save</Button>
        </div>
      </form>
    </Modal>
  )
}

interface GroupedLines {
  groupName: string
  isIncome: boolean
  lines: BudgetLineItem[]
}

function EditBudgetModal({
  year, month, incomeLines, expenseLines, categories, visibleCategories, onClose, onSaveVisibility,
}: {
  year: number
  month: number
  incomeLines: BudgetLineItem[]
  expenseLines: BudgetLineItem[]
  categories: Category[]
  visibleCategories: Set<number>
  onClose: () => void
  onSaveVisibility: (ids: Set<number>) => void
}) {
  const bulkCreate = useBulkCreateBudgets()

  // State for budget amounts: category_id -> amount string
  const [amounts, setAmounts] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {}
    for (const line of [...incomeLines, ...expenseLines]) {
      if (line.category_id) {
        initial[line.category_id] = line.budgeted > 0 ? String(line.budgeted) : ''
      }
    }
    return initial
  })

  // State for visibility checkboxes
  const [visible, setVisible] = useState<Set<number>>(() => new Set(visibleCategories))

  const toggleVisible = (catId: number) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(catId)) {
        next.delete(catId)
      } else {
        next.add(catId)
      }
      return next
    })
  }

  const updateAmount = (catId: number, value: string) => {
    setAmounts(prev => ({ ...prev, [catId]: value }))
  }

  // Group lines by parent category, preserving category order from database
  const groupedLines = useMemo(() => {
    const groups: GroupedLines[] = []

    // Build a map of category_id -> line for quick lookup
    const linesByCategory = new Map<number, BudgetLineItem>()
    for (const line of [...incomeLines, ...expenseLines]) {
      if (line.category_id) linesByCategory.set(line.category_id, line)
    }

    // Sort parent categories by GROUP_ORDER
    const sortedParents = [...categories].filter(c => c.children.length > 0).sort((a, b) => {
      const aIdx = GROUP_ORDER.indexOf(a.name)
      const bIdx = GROUP_ORDER.indexOf(b.name)
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
    })

    // Build groups using the same ordering as the transaction category dropdown
    for (const parent of sortedParents) {
      const lines: BudgetLineItem[] = []
      for (const child of sortCategoryChildren(parent.name, parent.children)) {
        const line = linesByCategory.get(child.id)
        if (line) lines.push(line)
      }
      if (lines.length > 0) {
        groups.push({ groupName: parent.name, isIncome: parent.is_income, lines })
      }
    }

    return groups
  }, [incomeLines, expenseLines, categories])

  // Calculate totals (only include checked/visible categories)
  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    for (const line of incomeLines) {
      if (line.category_id && visible.has(line.category_id)) {
        const val = parseFloat(amounts[line.category_id] || '0')
        if (!isNaN(val)) income += val
      }
    }
    for (const line of expenseLines) {
      if (line.category_id && visible.has(line.category_id)) {
        const val = parseFloat(amounts[line.category_id] || '0')
        if (!isNaN(val)) expense += val
      }
    }
    return { income, expense, net: income - expense }
  }, [amounts, incomeLines, expenseLines, visible])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Save visibility settings
    onSaveVisibility(visible)

    // Build bulk create payload for all non-empty budgets
    const payload: BudgetCreate[] = []
    for (const [catIdStr, amountStr] of Object.entries(amounts)) {
      const catId = parseInt(catIdStr)
      const parsed = parseFloat(amountStr)
      const amount = isNaN(parsed) ? 0 : parsed
      if (amount >= 0) {
        payload.push({ category_id: catId, year, month, amount })
      }
    }

    if (payload.length > 0) {
      await bulkCreate.mutateAsync(payload)
    }
    onClose()
  }

  const renderLine = (line: BudgetLineItem) => (
    <div key={line.category_id ?? line.category_name} className="flex items-center gap-3">
      {line.category_id && (
        <input
          type="checkbox"
          checked={visible.has(line.category_id)}
          onChange={() => toggleVisible(line.category_id!)}
          className="accent-amber-400 flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <span className={clsx('text-sm', visible.has(line.category_id!) ? 'text-ink-100' : 'text-ink-400')}>
          {line.category_name}
        </span>
      </div>
      <div className="text-xs text-ink-400 font-mono w-20 text-right">
        {formatCurrency(line.actual)}
      </div>
      {line.category_id && (
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amounts[line.category_id] ?? ''}
          onChange={e => updateAmount(line.category_id!, e.target.value)}
          onWheel={e => (e.target as HTMLInputElement).blur()}
          className="w-28 bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm font-mono text-ink-100 text-right focus:outline-none focus:border-amber-400/40 transition-colors"
        />
      )}
    </div>
  )

  return (
    <Modal onClose={onClose} className="max-w-2xl max-h-[85vh] flex flex-col">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Edit Budget</h2>
      <p className="text-sm text-ink-300 mb-4">{MONTHS[month - 1]} {year}</p>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto pr-2 space-y-5">
          {groupedLines.map((group, idx) => (
            <div key={`${group.groupName}-${group.isIncome}`}>
              <div className={clsx(
                'flex items-center justify-between mb-2 pb-1 border-b',
                group.isIncome ? 'border-teal-400/20' : 'border-rose-400/20'
              )}>
                <h3 className={clsx(
                  'text-xs font-medium uppercase tracking-wide',
                  group.isIncome ? 'text-teal-400' : 'text-rose-400'
                )}>
                  {group.groupName}
                </h3>
              </div>
              <div className="space-y-1.5">
                {group.lines.map(renderLine)}
              </div>
            </div>
          ))}
        </div>

        {/* Footer with totals and buttons */}
        <div className="border-t border-white/[0.06] pt-4 mt-4">
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-ink-400">Income</span>
            <span className="font-mono text-teal-400">{formatCurrency(totals.income)}</span>
          </div>
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-ink-400">Expenses</span>
            <span className="font-mono text-rose-400">{formatCurrency(totals.expense)}</span>
          </div>
          <div className="flex items-center justify-between mb-4 text-sm">
            <span className="text-ink-300 font-medium">Net Budgeted</span>
            <span className="font-mono font-medium text-ink-100">
              {totals.net >= 0 ? '+' : ''}{formatCurrency(totals.net)}
            </span>
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" variant="primary" loading={bulkCreate.isPending} className="flex-1">
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function CopyBudgetModal({
  fromYear,
  fromMonth,
  sourceVisible,
  onClose,
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

export default function BudgetPage() {
  const now = currentYearMonth()
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [showEdit, setShowEdit] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const [editLine, setEditLine] = useState<BudgetLineItem | null>(null)
  const [visibleCategories, setVisibleCategories] = useState<Set<number>>(new Set())
  const [autoCarryDone, setAutoCarryDone] = useState<Set<string>>(new Set())
  const [visibilityInitDone, setVisibilityInitDone] = useState<Set<string>>(new Set())

  const { data: report, isLoading } = useBudgetReport(year, month)
  const { data: categories } = useCategories()
  const { data: budgets } = useBudgets({ year, month })
  const previousMonth = getPreviousMonth(year, month)
  const { data: previousBudgets } = useBudgets({ year: previousMonth.year, month: previousMonth.month })
  const { data: demoStatus } = useDemoStatus()
  const bulkCreateBudgets = useBulkCreateBudgets()
  const setBudgetVisibleCategories = useSetBudgetVisibleCategories()
  const isDemo = !!demoStatus?.has_demo_data
  const visibility = useBudgetVisibleCategories(year, month, !isDemo && demoStatus !== undefined)
  const previousVisibility = useBudgetVisibleCategories(previousMonth.year, previousMonth.month, !isDemo && demoStatus !== undefined)

  // Sync visible categories for the selected month.
  // Demo mode: derive from DEMO_DEFAULT_VISIBLE (local-only).
  // Real mode: load from server; if missing, carry from previous month, else default all checked.
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

    // Server says: no value set yet for this month. Create one (once) so it's shared across devices.
    if (serverIds === null) {
      if (visibilityInitDone.has(key)) return
      setVisibilityInitDone(prev => new Set(prev).add(key))

      const prevIds = previousVisibility.data?.category_ids
      const ids = Array.isArray(prevIds) && prevIds.length > 0
        ? new Set<number>(prevIds)
        : new Set<number>(leaves.map(l => l.id))

      setVisibleCategories(ids)
      setBudgetVisibleCategories.mutate({
        year,
        month,
        category_ids: [...ids],
      })
    }
  }, [categories, demoStatus, year, month, visibility.data?.category_ids, previousVisibility.data?.category_ids, visibilityInitDone, setBudgetVisibleCategories])

  const handleSaveVisibility = useCallback((ids: Set<number>) => {
    setVisibleCategories(ids)
    if (demoStatus?.has_demo_data) {
      return
    }
    setBudgetVisibleCategories.mutate({ year, month, category_ids: [...ids] })
  }, [demoStatus, setBudgetVisibleCategories, year, month])

  // Auto-carry budget values (and selected categories) into the new current month from the previous month.
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

    const payload: BudgetCreate[] = previousBudgets.map(b => ({
      category_id: b.category_id,
      year,
      month,
      amount: b.amount,
      notes: b.notes,
    }))

    bulkCreateBudgets.mutate(payload, {
      onSuccess: () => {
        setAutoCarryDone(prev => new Set(prev).add(key))
      },
      onError: () => {
        setAutoCarryDone(prev => new Set(prev).add(key))
      },
    })
  }, [demoStatus, budgets, previousBudgets, year, month, now.year, now.month, autoCarryDone, bulkCreateBudgets, previousMonth.year, previousMonth.month])

  // Build a map of existing budgets: category_id -> amount
  const existingBudgets = useMemo(() => {
    const map = new Map<number, number>()
    if (budgets) {
      for (const b of budgets) {
        map.set(b.category_id, b.amount)
      }
    }
    return map
  }, [budgets])

  // Build budget lines for ALL leaf categories, merging with report data
  const allLines = useMemo(() => {
    if (!categories) return { income: [], expense: [] }

    // Flatten categories to get all leaves
    const flatten = (cats: Category[]): Category[] =>
      cats.flatMap(c => c.children.length > 0 ? flatten(c.children) : [c])

    const leaves = flatten(categories)
    const incomeLeaves = leaves.filter(c => c.is_income)
    const expenseLeaves = leaves.filter(c => !c.is_income)

    // Get actuals from report if available
    const reportIncomeMap = new Map<number, BudgetLineItem>()
    const reportExpenseMap = new Map<number, BudgetLineItem>()
    if (report) {
      for (const line of report.income_lines) {
        if (line.category_id) reportIncomeMap.set(line.category_id, line)
      }
      for (const line of report.expense_lines) {
        if (line.category_id) reportExpenseMap.set(line.category_id, line)
      }
    }

    // Find parent name helper
    const getParentName = (cat: Category): string | undefined => {
      if (!cat.parent_id) return undefined
      const allCats = categories.flatMap(c => [c, ...c.children])
      const parent = allCats.find(p => p.id === cat.parent_id)
      return parent?.name
    }

    const buildLine = (cat: Category, reportLine?: BudgetLineItem): BudgetLineItem => {
      const budgeted = existingBudgets.get(cat.id) ?? 0
      const actual = reportLine?.actual ?? 0
      const remaining = budgeted - actual
      return {
        category_id: cat.id,
        category_name: cat.name,
        parent_category_name: getParentName(cat),
        is_income: cat.is_income,
        budgeted,
        actual,
        remaining,
        percent_used: budgeted > 0 ? Math.round((actual / budgeted) * 100 * 10) / 10 : undefined,
        transaction_count: reportLine?.transaction_count ?? 0,
      }
    }

    const incomeLines = incomeLeaves.map(cat => buildLine(cat, reportIncomeMap.get(cat.id)))
    const expenseLines = expenseLeaves.map(cat => buildLine(cat, reportExpenseMap.get(cat.id)))

    return { income: incomeLines, expense: expenseLines }
  }, [categories, report, existingBudgets])

  // Build display lines: visible categories shown individually, others aggregated into "Other"
  const displayLines = useMemo(() => {
    const visibleIncome: BudgetLineItem[] = []
    const visibleExpense: BudgetLineItem[] = []
    let otherIncome: BudgetLineItem | null = null
    let otherExpense: BudgetLineItem | null = null

    // Helper to check if a category should merge into "Other"
    const isOtherCategory = (name: string) => {
      const lower = name.toLowerCase()
      return lower === 'other income' || lower === 'other expense'
    }

    // Track if the "Other Income"/"Other Expense" categories are checked
    let otherIncomeChecked = false
    let otherExpenseChecked = false

    for (const line of allLines.income) {
      const isOther = isOtherCategory(line.category_name)
      const isVisible = line.category_id && visibleCategories.has(line.category_id)

      // Track if the actual "Other Income" category is checked
      if (isOther && isVisible) {
        otherIncomeChecked = true
      }

      // "Other Income" category always merges into the aggregate bucket
      if (isOther || !isVisible) {
        if (!otherIncome) {
          otherIncome = {
            category_id: undefined,
            category_name: 'Other Income',
            parent_category_name: undefined,
            is_income: true,
            budgeted: 0,
            actual: 0,
            remaining: 0,
            percent_used: undefined,
            transaction_count: 0,
          }
        }
        otherIncome.actual += line.actual
        otherIncome.transaction_count += line.transaction_count
        // Include budget if the category is checked
        if (isVisible) {
          otherIncome.budgeted += line.budgeted
        }
      } else {
        visibleIncome.push(line)
      }
    }

    for (const line of allLines.expense) {
      const isOther = isOtherCategory(line.category_name)
      const isVisible = line.category_id && visibleCategories.has(line.category_id)

      // Track if the actual "Other Expense" category is checked
      if (isOther && isVisible) {
        otherExpenseChecked = true
      }

      // "Other Expense" category always merges into the aggregate bucket
      if (isOther || !isVisible) {
        if (!otherExpense) {
          otherExpense = {
            category_id: undefined,
            category_name: 'Other Expenses',
            parent_category_name: undefined,
            is_income: false,
            budgeted: 0,
            actual: 0,
            remaining: 0,
            percent_used: undefined,
            transaction_count: 0,
          }
        }
        otherExpense.actual += line.actual
        otherExpense.transaction_count += line.transaction_count
        // Include budget if the category is checked
        if (isVisible) {
          otherExpense.budgeted += line.budgeted
        }
      } else {
        visibleExpense.push(line)
      }
    }

    // Show "Other" items if:
    // 1. The "Other Income"/"Other Expense" category is checked, OR
    // 2. There are values (actual > 0 or budgeted > 0)
    const showOtherIncome = otherIncomeChecked || (otherIncome && (otherIncome.actual > 0 || otherIncome.budgeted > 0))
    const showOtherExpense = otherExpenseChecked || (otherExpense && (otherExpense.actual > 0 || otherExpense.budgeted > 0))

    if (showOtherIncome) {
      if (!otherIncome) {
        otherIncome = {
          category_id: undefined,
          category_name: 'Other Income',
          parent_category_name: undefined,
          is_income: true,
          budgeted: 0,
          actual: 0,
          remaining: 0,
          percent_used: undefined,
          transaction_count: 0,
        }
      }
      otherIncome.remaining = otherIncome.budgeted - otherIncome.actual
      otherIncome.percent_used = otherIncome.budgeted > 0
        ? Math.round((otherIncome.actual / otherIncome.budgeted) * 100 * 10) / 10
        : undefined
      visibleIncome.push(otherIncome)
    }

    if (showOtherExpense) {
      if (!otherExpense) {
        otherExpense = {
          category_id: undefined,
          category_name: 'Other Expenses',
          parent_category_name: undefined,
          is_income: false,
          budgeted: 0,
          actual: 0,
          remaining: 0,
          percent_used: undefined,
          transaction_count: 0,
        }
      }
      otherExpense.remaining = otherExpense.budgeted - otherExpense.actual
      otherExpense.percent_used = otherExpense.budgeted > 0
        ? Math.round((otherExpense.actual / otherExpense.budgeted) * 100 * 10) / 10
        : undefined
      visibleExpense.push(otherExpense)
    }

    return { income: visibleIncome, expense: visibleExpense }
  }, [allLines, visibleCategories])

  const categorySections = useMemo(() => {
    const grouped = new Map<string, BudgetLineItem[]>()
    for (const groupName of GROUP_ORDER) {
      grouped.set(groupName, [])
    }

    for (const line of [...displayLines.income, ...displayLines.expense]) {
      const groupName = line.parent_category_name
        ?? (line.category_name.toLowerCase().startsWith('other ') ? 'Other' : (line.is_income ? 'Income' : 'Other'))
      if (!grouped.has(groupName)) {
        grouped.set(groupName, [])
      }
      grouped.get(groupName)!.push(line)
    }

    return GROUP_ORDER
      .map(groupName => {
        const lines = grouped.get(groupName) ?? []
        const current = lines.reduce((sum, line) => sum + line.actual, 0)
        const budgeted = lines.reduce((sum, line) => sum + line.budgeted, 0)
        return { groupName, lines, current, budgeted }
      })
      .filter(section => section.lines.length > 0)
  }, [displayLines])


  // Calculate totals from visible categories only (budgeted excludes unchecked)
  const totals = useMemo(() => {
    // Actuals include all transactions
    const totalIncomeActual = allLines.income.reduce((sum, l) => sum + l.actual, 0)
    const totalExpensesActual = allLines.expense.reduce((sum, l) => sum + l.actual, 0)
    // Budgeted only includes visible categories
    const totalIncomeBudgeted = allLines.income
      .filter(l => l.category_id && visibleCategories.has(l.category_id))
      .reduce((sum, l) => sum + l.budgeted, 0)
    const totalExpensesBudgeted = allLines.expense
      .filter(l => l.category_id && visibleCategories.has(l.category_id))
      .reduce((sum, l) => sum + l.budgeted, 0)
    return {
      incomeBudgeted: totalIncomeBudgeted,
      incomeActual: totalIncomeActual,
      expensesBudgeted: totalExpensesBudgeted,
      expensesActual: totalExpensesActual,
      netActual: totalIncomeActual - totalExpensesActual,
      netBudgeted: totalIncomeBudgeted - totalExpensesBudgeted,
    }
  }, [allLines, visibleCategories])

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title="Budget"
        subtitle=""
        action={
          <div className="flex items-center gap-2">
            <select
              value={`${year}-${month}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number)
                setYear(y)
                setMonth(m)
              }}
              className="hidden md:block bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none"
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
            <Button variant="secondary" size="sm" onClick={() => setShowCopy(true)}>
              Copy Budget
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowEdit(true)}>
              Edit Budget
            </Button>
          </div>
        }
        extra={
          <div className="flex justify-end md:hidden">
          <select
            value={`${year}-${month}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              setYear(y)
              setMonth(m)
            }}
            className="bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none"
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
        }
      />

      {/* Summary KPIs */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Mobile: Actual | Budgeted columns, Income / Expenses / Net rows */}
          <div className="grid grid-cols-2 gap-4 lg:hidden">
            <StatCard label="Income (Actual)"     value={totals.incomeActual}     positive wholeDollars />
            <StatCard label="Income (Budgeted)"   value={totals.incomeBudgeted}   wholeDollars />
            <StatCard label="Expenses (Actual)"   value={totals.expensesActual}   negative wholeDollars />
            <StatCard label="Expenses (Budgeted)" value={totals.expensesBudgeted} wholeDollars />
            <StatCard label="Net (Actual)"        value={totals.netActual}        format="signed" autoSign wholeDollars />
            <StatCard label="Net (Budgeted)"      value={totals.netBudgeted}      format="signed" wholeDollars />
          </div>
          {/* Desktop: original layout */}
          <div className="hidden lg:grid grid-cols-4 gap-4">
            <StatCard label="Income (Actual)"     value={totals.incomeActual}     positive wholeDollars />
            <StatCard label="Expenses (Actual)"   value={totals.expensesActual}   negative wholeDollars />
            <StatCard label="Income (Budgeted)"   value={totals.incomeBudgeted}   wholeDollars />
            <StatCard label="Expenses (Budgeted)" value={totals.expensesBudgeted} wholeDollars />
          </div>
          <div className="hidden lg:grid grid-cols-2 gap-4">
            <StatCard label="Net (Actual)"   value={totals.netActual}   format="signed" autoSign wholeDollars />
            <StatCard label="Net (Budgeted)" value={totals.netBudgeted} format="signed" wholeDollars />
          </div>
          {categorySections.map(section => {
            const isIncome = section.groupName === 'Income'
            return (
              <Card key={section.groupName}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={clsx('w-2 h-2 rounded-full', isIncome ? 'bg-teal-400' : 'bg-rose-400')} />
                    <h2 className="text-sm font-semibold text-ink-100">{section.groupName}</h2>
                  </div>
                  <span className={clsx('text-sm font-mono', isIncome ? 'text-teal-400' : 'text-rose-400')}>
                    {formatCurrencyWhole(section.current)} / {formatCurrencyWhole(section.budgeted)}
                  </span>
                </div>
                <div className="mb-3 text-2xs text-ink-400 text-right">Current / Budgeted</div>
                <div>
                  {section.lines.map(line => (
                    <BudgetLineRow
                      key={line.category_id ?? `${section.groupName}-${line.category_name}`}
                      line={line}
                      onClick={() => setEditLine(line)}
                    />
                  ))}
                </div>
              </Card>
            )
          })}
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

      {showEdit && categories && (
        <EditBudgetModal
          year={year}
          month={month}
          incomeLines={allLines.income.filter(l => l.category_name.toLowerCase() !== 'uncategorized')}
          expenseLines={allLines.expense.filter(l => l.category_name.toLowerCase() !== 'uncategorized')}
          categories={categories}
          visibleCategories={visibleCategories}
          onClose={() => setShowEdit(false)}
          onSaveVisibility={handleSaveVisibility}
        />
      )}

      {editLine && editLine.category_id && (
        <SetBudgetModal
          line={editLine}
          year={year}
          month={month}
          onClose={() => setEditLine(null)}
        />
      )}
    </div>
  )
}








