import { useState, useMemo, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTransactions, useAccounts, useCategories, useCreateTransaction, useUpdateTransaction, useDeleteTransaction } from '@/hooks'
import { Card, PageHeader, Button, EmptyState, Spinner, Modal } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Transaction, TransactionUpdate, TransactionCreate, TransactionType, Category } from '@/types'
import clsx from 'clsx'

type DateFilterPreset = 'last3Months' | 'thisMonth' | 'lastMonth' | 'pastYear' | 'custom'

function getDateRange(preset: DateFilterPreset): { from: string; to: string } | null {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  // For presets anchored to "now", extend to end of current month so
  // future-dated (pending) transactions within the month are always visible.
  const endOfMonth = new Date(year, month + 1, 0).toISOString().slice(0, 10)

  switch (preset) {
    case 'last3Months': {
      // Current month + previous three months, aligned to month boundaries.
      const from = new Date(year, month - 3, 1)
      return { from: from.toISOString().slice(0, 10), to: endOfMonth }
    }
    case 'thisMonth': {
      const from = new Date(year, month, 1)
      return { from: from.toISOString().slice(0, 10), to: endOfMonth }
    }
    case 'lastMonth': {
      const from = new Date(year, month - 1, 1)
      const to = new Date(year, month, 0) // Last day of previous month
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
    }
    case 'pastYear': {
      const from = new Date(today)
      from.setFullYear(from.getFullYear() - 1)
      return { from: from.toISOString().slice(0, 10), to: endOfMonth }
    }
    case 'custom':
      return null
  }
}

function formatMonthHeader(yearMonth: string): string {
  // yearMonth is "YYYY-MM" format
  const [year, month] = yearMonth.split('-').map(Number)
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  return `${monthNames[month - 1]} ${year}`
}

function formatShortDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" format - parse directly to avoid timezone issues
  const [, month, day] = dateStr.split('-').map(Number)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[month - 1]} ${day}`
}

function endOfCurrentMonth(): string {
  const today = new Date()
  return new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)
}

function flattenCategories(cats: Category[]): Category[] {
  return cats.flatMap(c => [c, ...flattenCategories(c.children)])
}

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

function useOnClickOutside(ref: React.RefObject<HTMLElement>, handler: () => void) {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      handler()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [ref, handler])
}

function FilterDropdown({
  buttonLabel,
  isActive,
  children,
  disabled,
}: {
  buttonLabel: string
  isActive: boolean
  children: React.ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useOnClickOutside(rootRef, () => setOpen(false))

  const recomputeAlignment = () => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 288
    const pad = 16

    // Compare left-aligned vs right-aligned overflow (lower score wins)
    const overflowRightLeft = Math.max(0, rect.left + width - (window.innerWidth - pad))
    const overflowLeftLeft = Math.max(0, pad - rect.left)
    const overflowRightRight = Math.max(0, rect.right - (window.innerWidth - pad))
    const overflowLeftRight = Math.max(0, pad - (rect.right - width))

    const scoreLeft = overflowRightLeft + overflowLeftLeft
    const scoreRight = overflowRightRight + overflowLeftRight

    setAlignRight(scoreRight < scoreLeft)
  }

  useEffect(() => {
    if (!open) return
    recomputeAlignment()

    const onResize = () => recomputeAlignment()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('resize', onResize)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'bg-surface-700 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none transition-colors inline-flex items-center gap-2',
          isActive ? 'border border-amber-400/40 bg-amber-400/5 text-amber-300' : 'border border-white/[0.08]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className="truncate max-w-44">{buttonLabel}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className={clsx('w-4 h-4 text-ink-400 transition-transform', open && 'rotate-180')}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          className={clsx(
            'absolute z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-surface-800 border border-white/[0.08] rounded-xl shadow-xl overflow-hidden',
            alignRight ? 'right-0' : 'left-0'
          )}
        >
          <div className="max-h-80 overflow-auto p-2">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

function CheckboxRow({
  checked,
  indeterminate,
  label,
  sublabel,
  onToggle,
  disabled,
  bold,
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  sublabel?: string
  onToggle: () => void
  disabled?: boolean
  bold?: boolean
}) {
  const cbRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!cbRef.current) return
    cbRef.current.indeterminate = Boolean(indeterminate) && !checked
  }, [indeterminate, checked])

  return (
    <label
      className={clsx(
        'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-white/[0.04] transition-colors cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
      )}
    >
      <input
        ref={cbRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle()}
        className="accent-amber-400"
      />
      <div className="flex-1 min-w-0">
        <div className={clsx('text-sm truncate', bold ? 'text-ink-100 font-medium' : 'text-ink-200')}>{label}</div>
        {sublabel && <div className="text-xs text-ink-500 truncate">{sublabel}</div>}
      </div>
    </label>
  )
}

function CategorySelect({ value, onChange, categories }: {
  value: number | undefined
  onChange: (id: number | undefined) => void
  categories: Category[]
}) {
  // Group categories: parent categories that have children become optgroups
  // Explicit order: Income, Essential, Utilities, Lifestyle, Financial, Other
  const groupOrder = ['Income', 'Essential', 'Utilities', 'Lifestyle', 'Financial', 'Other']
  const parentCategories = categories.filter(c => c.children.length > 0)
  const sortedGroups = parentCategories.sort((a, b) => {
    const aIdx = groupOrder.indexOf(a.name)
    const bIdx = groupOrder.indexOf(b.name)
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
  })

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
      className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
    >
      <option value="">Uncategorized</option>
      {sortedGroups.map(parent => (
        <optgroup key={parent.id} label={parent.name}>
          {sortCategoryChildren(parent.name, parent.children).map(child => (
            <option key={child.id} value={child.id}>{child.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function EditTransactionModal({ tx, categories, onClose }: {
  tx: Transaction
  categories: Category[]
  onClose: () => void
}) {
  const update = useUpdateTransaction(tx.id)
  const deleteTx = useDeleteTransaction()
  const [form, setForm] = useState<TransactionUpdate>({
    date: tx.date,
    amount: tx.amount,
    transaction_type: tx.transaction_type,
    category_id: tx.category_id,
    description: tx.description ?? tx.original_description,
    is_transfer: tx.is_transfer,
    exclude_from_budget: tx.exclude_from_budget,
    is_annualized: tx.is_annualized,
    notes: tx.notes ?? '',
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const origDescription = tx.description ?? tx.original_description
    const origCategoryId = tx.category_id ?? null
    const patch: TransactionUpdate = {}
    if (form.date && form.date !== tx.date) patch.date = form.date
    if (form.amount && form.amount !== tx.amount) patch.amount = form.amount
    if (form.transaction_type !== tx.transaction_type) patch.transaction_type = form.transaction_type
    if ((form.category_id ?? null) !== origCategoryId) patch.category_id = form.category_id ?? null
    if (form.description !== origDescription) patch.description = form.description
    if (form.is_transfer !== tx.is_transfer) patch.is_transfer = form.is_transfer
    if (form.exclude_from_budget !== tx.exclude_from_budget) patch.exclude_from_budget = form.exclude_from_budget
    if (form.is_annualized !== tx.is_annualized) patch.is_annualized = form.is_annualized
    if ((form.notes ?? '') !== (tx.notes ?? '')) patch.notes = form.notes ?? null
    try {
      await update.mutateAsync(patch)
      onClose()
    } catch {
      // onError handles the toast
    }
  }

  const handleDelete = async () => {
    await deleteTx.mutateAsync(tx.id)
    onClose()
  }

  return (
    <Modal onClose={onClose} className="max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)]">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Edit Transaction</h2>
      <p className="text-sm text-ink-300 mb-3 font-mono">{tx.original_description}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">Date</label>
            <input
              type="date"
              value={form.date ?? ''}
              max={endOfCurrentMonth()}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
            />
          </div>
          <div>
            <label className="label block mb-1.5">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount ?? ''}
              onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || undefined }))}
              onWheel={e => (e.target as HTMLInputElement).blur()}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="label block mb-1.5">Type</label>
          <select
            value={form.transaction_type ?? 'debit'}
            onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as TransactionType, category_id: undefined }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          >
            <option value="debit">Debit (expense)</option>
            <option value="credit">Credit (income)</option>
          </select>
        </div>
        <div>
          <label className="label block mb-1.5">Description</label>
          <input
            value={form.description ?? ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          />
        </div>
        <div>
          <label className="label block mb-1.5">Category</label>
          <CategorySelect
            value={form.category_id ?? undefined}
            onChange={id => setForm(f => ({ ...f, category_id: id }))}
            categories={categories}
          />
        </div>
        <div className="space-y-2">
          {[
            { key: 'is_transfer' as const, label: 'Mark as transfer (exclude from budget)' },
            { key: 'exclude_from_budget' as const, label: 'Exclude from budget' },
            { key: 'is_annualized' as const, label: 'Annualized (spread over 12 months)' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                className="accent-amber-400"
              />
              <span className="text-sm text-ink-200">{label}</span>
            </label>
          ))}
        </div>
        <div>
          <label className="label block mb-1.5">Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors resize-none"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" loading={update.isPending} className="flex-1">Save</Button>
        </div>
      </form>

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        {showDeleteConfirm ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-400">
              Delete "{tx.description || tx.original_description}"? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button type="button" variant="ghost" onClick={() => setShowDeleteConfirm(false)} className="flex-1">
                Cancel
              </Button>
              <Button type="button" variant="danger" loading={deleteTx.isPending} onClick={handleDelete} className="flex-1">
                Delete Transaction
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="danger" onClick={() => setShowDeleteConfirm(true)} className="w-full">
            Delete Transaction
          </Button>
        )}
      </div>
    </Modal>
  )
}

function AddTransactionModal({ accounts, categories, onClose }: {
  accounts: { id: number; name: string }[]
  categories: Category[]
  onClose: () => void
}) {
  const create = useCreateTransaction()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<TransactionCreate>({
    account_id: accounts[0]?.id ?? 0,
    date: today,
    amount: 0,
    transaction_type: 'debit',
    original_description: '',
    category_id: undefined,
    is_transfer: false,
    exclude_from_budget: false,
    is_annualized: false,
    notes: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.original_description.trim() || form.amount <= 0 || !form.account_id) return
    try {
      await create.mutateAsync({ ...form, description: form.original_description })
      onClose()
    } catch {
      // onError handles the toast
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)]">
      <h2 className="text-base font-semibold text-ink-100 mb-5">Add Transaction</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label block mb-1.5">Account</label>
          <select
            required
            value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: Number(e.target.value) }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label block mb-1.5">Date</label>
            <input
              type="date"
              required
              value={form.date}
              max={endOfCurrentMonth()}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
            />
          </div>
          <div>
            <label className="label block mb-1.5">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0.00"
              value={form.amount || ''}
              onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
              onWheel={e => (e.target as HTMLInputElement).blur()}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="label block mb-1.5">Type</label>
          <select
            value={form.transaction_type}
            onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as TransactionType, category_id: undefined }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          >
            <option value="debit">Debit (expense)</option>
            <option value="credit">Credit (income)</option>
          </select>
        </div>
        <div>
          <label className="label block mb-1.5">Description</label>
          <input
            required
            placeholder="e.g. Grocery run"
            value={form.original_description}
            onChange={e => setForm(f => ({ ...f, original_description: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors"
          />
        </div>
        <div>
          <label className="label block mb-1.5">Category</label>
          <CategorySelect
            value={form.category_id ?? undefined}
            onChange={id => setForm(f => ({ ...f, category_id: id }))}
            categories={categories}
          />
        </div>
        <div>
          <label className="label block mb-1.5">Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors resize-none"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">Add</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function TransactionsPage() {
  const [datePreset, setDatePreset] = useState<DateFilterPreset>('last3Months')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filters, setFilters] = useState({
    search: '',
    transaction_type: undefined as 'debit' | 'credit' | undefined,
    min_amount: undefined as number | undefined,
    max_amount: undefined as number | undefined,
    limit: 500,
  })
  const [accountFilter, setAccountFilter] = useState<{
    mode: 'all' | 'selected'
    accountIds: number[]
  }>({ mode: 'all', accountIds: [] })
  const [categoryFilter, setCategoryFilter] = useState<{
    mode: 'all' | 'selected'
    categoryIds: number[]
    includeUncategorized: boolean
  }>({ mode: 'all', categoryIds: [], includeUncategorized: false })
  const [tagFilter, setTagFilter] = useState<{
    mode: 'any' | 'selected'
    tags: Array<'is_transfer' | 'exclude_from_budget' | 'is_annualized' | 'is_pending'>
  }>({ mode: 'any', tags: [] })
  const [excludedCfCategoryKeys, setExcludedCfCategoryKeys] = useState<string[]>([])
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const location = useLocation()

  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const from = sp.get('from')
    const to = sp.get('to')
    const excludeCf = sp.get('exclude_cf')

    const hasAny = Boolean(from || to || excludeCf)
    if (!hasAny) return

    if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      setDatePreset('custom')
      setCustomFrom(from)
      setCustomTo(to)
    }

    if (excludeCf != null) {
      const keys = excludeCf.split(',').map(s => s.trim()).filter(Boolean)
      setExcludedCfCategoryKeys(keys)
    }

    // When arriving from a report, reset other filters to avoid confusing combinations.
    setAccountFilter({ mode: 'all', accountIds: [] })
    setCategoryFilter({ mode: 'all', categoryIds: [], includeUncategorized: false })
    setTagFilter({ mode: 'any', tags: [] })
  }, [location.search])
  // Calculate date range based on preset or custom dates
  const dateRange = datePreset === 'custom'
    ? (customFrom && customTo ? { from: customFrom, to: customTo } : null)
    : getDateRange(datePreset)

  const queryFilters = {
    ...filters,
    date_from: dateRange?.from,
    date_to: dateRange?.to,
  }

  const { data: transactions, isLoading } = useTransactions(queryFilters)
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories({ flat: true })
  const todayStr = new Date().toISOString().slice(0, 10)
  const categoryNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of categories ?? []) map.set(c.id, c.name)
    return map
  }, [categories])

  const filteredTransactions = useMemo(() => {
    if (!transactions) return undefined

    const hasAccountFilter = accountFilter.mode === 'selected' && accountFilter.accountIds.length > 0
    const hasCategoryFilter =
      categoryFilter.mode === 'selected' &&
      (categoryFilter.categoryIds.length > 0 || categoryFilter.includeUncategorized)

    const hasTagFilter = tagFilter.mode === 'selected' && tagFilter.tags.length > 0

    const accountIdSet = hasAccountFilter ? new Set(accountFilter.accountIds) : undefined
    const categoryIdSet = hasCategoryFilter ? new Set(categoryFilter.categoryIds) : undefined
    const tagSet = hasTagFilter ? new Set(tagFilter.tags) : undefined

    const hasCfExclusions = excludedCfCategoryKeys.length > 0
    const excludedCategoryIds = new Set<number>()
    const excludedCategoryNames = new Set<string>()
    let excludeUncategorized = false

    if (hasCfExclusions) {
      for (const key of excludedCfCategoryKeys) {
        if (key === 'uncategorized') { excludeUncategorized = true; continue }
        if (key.startsWith('id:')) {
          const n = Number(key.slice(3))
          if (Number.isFinite(n)) excludedCategoryIds.add(n)
          continue
        }
        if (key.startsWith('name:')) {
          const name = key.slice(5)
          if (name.toLowerCase() === 'uncategorized') excludeUncategorized = true
          else if (name) excludedCategoryNames.add(name)
        }
      }
    }

    return transactions.filter(tx => {
      if (hasAccountFilter && accountIdSet && !accountIdSet.has(tx.account_id)) return false

      if (hasCfExclusions) {
        if (tx.category_id != null && excludedCategoryIds.has(tx.category_id as number)) return false
        if (excludeUncategorized && tx.category_id == null) return false
        if (tx.category_name && excludedCategoryNames.has(tx.category_name)) return false
      }

      if (hasCategoryFilter) {
        const isUncat = tx.category_id == null
        const matchesCat =
          (categoryFilter.includeUncategorized && isUncat) ||
          (!isUncat && categoryIdSet?.has(tx.category_id as number))
        if (!matchesCat) return false
      }

      if (hasTagFilter && tagSet) {
        const matchesTag =
          (tagSet.has('is_transfer') && tx.is_transfer) ||
          (tagSet.has('exclude_from_budget') && tx.exclude_from_budget) ||
          (tagSet.has('is_annualized') && tx.is_annualized) ||
          (tagSet.has('is_pending') && tx.is_pending)
        if (!matchesTag) return false
      }

      return true
    })
  }, [transactions, accountFilter, categoryFilter, tagFilter, excludedCfCategoryKeys])
  const accountsWithTransactions = useMemo(() => {
    if (!accounts?.length || !transactions?.length) return []
    const accountIdsWithTransactions = new Set(transactions.map(tx => tx.account_id))
    return accounts.filter(account => accountIdsWithTransactions.has(account.id))
  }, [accounts, transactions])

  const accountNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const a of accountsWithTransactions) map.set(a.id, a.name)
    return map
  }, [accountsWithTransactions])
  // Group transactions by month
  const transactionsByMonth = useMemo(() => {
    if (!filteredTransactions) return []

    // Sort transactions by date descending to ensure proper grouping
    const sorted = [...filteredTransactions].sort((a, b) => b.date.localeCompare(a.date))

    const groups: { month: string; label: string; transactions: Transaction[] }[] = []
    let currentMonth = ''

    for (const tx of sorted) {
      const txMonth = tx.date.slice(0, 7) // YYYY-MM
      if (txMonth !== currentMonth) {
        currentMonth = txMonth
        groups.push({
          month: txMonth,
          label: formatMonthHeader(txMonth),
          transactions: [],
        })
      }
      groups[groups.length - 1].transactions.push(tx)
    }

    return groups
  }, [filteredTransactions])

  const clearFilters = () => {
    setDatePreset('last3Months')
    setCustomFrom('')
    setCustomTo('')
    setFilters({
      search: '',
      transaction_type: undefined,
      min_amount: undefined,
      max_amount: undefined,
      limit: 500,
    })
    setAccountFilter({ mode: 'all', accountIds: [] })
    setCategoryFilter({ mode: 'all', categoryIds: [], includeUncategorized: false })
    setTagFilter({ mode: 'any', tags: [] })
    setExcludedCfCategoryKeys([])
  }

  const hasActiveFilters =
    datePreset !== 'last3Months' ||
    filters.search ||
    (accountFilter.mode === 'selected' && accountFilter.accountIds.length > 0) ||
    filters.transaction_type !== undefined ||
    filters.min_amount !== undefined ||
    filters.max_amount !== undefined ||
    (categoryFilter.mode === 'selected' && (categoryFilter.categoryIds.length > 0 || categoryFilter.includeUncategorized)) ||
    (tagFilter.mode === 'selected' && tagFilter.tags.length > 0) ||
    excludedCfCategoryKeys.length > 0

  useEffect(() => {
    if (accountFilter.mode !== 'selected') return
    if (accountFilter.accountIds.length === 0) {
      setAccountFilter({ mode: 'all', accountIds: [] })
      return
    }
    const valid = new Set(accountsWithTransactions.map(a => a.id))
    const nextIds = accountFilter.accountIds.filter(id => valid.has(id))
    if (nextIds.length === accountFilter.accountIds.length) return
    setAccountFilter(nextIds.length ? { mode: 'selected', accountIds: nextIds } : { mode: 'all', accountIds: [] })
  }, [accountsWithTransactions, accountFilter])

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title="Transactions"
        subtitle={filteredTransactions ? `${filteredTransactions.length} transactions` : undefined}
        action={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
              + Add Transaction
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <div className="space-y-2">
          {/* Row 1: search + account */}
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search description, merchant..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value || '' }))}
              className={clsx(
                'flex-1 min-w-48 bg-surface-700 rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none transition-colors',
                filters.search ? 'border border-amber-400/40 bg-amber-400/5' : 'border border-white/[0.08]'
              )}
            />
            <FilterDropdown
              disabled={!accountsWithTransactions.length}
              isActive={accountFilter.mode === 'selected' && accountFilter.accountIds.length > 0}
              buttonLabel={(() => {
                if (accountFilter.mode === 'all') return 'All accounts'
                if (accountFilter.accountIds.length === 1) return accountNameById.get(accountFilter.accountIds[0]) ?? '1 account'
                return `${accountFilter.accountIds.length} selected`
              })()}
            >
              <CheckboxRow
                checked={accountFilter.mode === 'all'}
                label="All accounts"
                onToggle={() => setAccountFilter({ mode: 'all', accountIds: [] })}
                bold
              />
              <div className="h-px bg-white/[0.06] my-1" />
              {accountsWithTransactions.map(a => (
                <CheckboxRow
                  key={a.id}
                  checked={accountFilter.mode === 'selected' && accountFilter.accountIds.includes(a.id)}
                  label={a.name}
                  onToggle={() => {
                    setAccountFilter(prev => {
                      const set = new Set(prev.mode === 'selected' ? prev.accountIds : [])
                      if (set.has(a.id)) set.delete(a.id)
                      else set.add(a.id)
                      const nextIds = Array.from(set.values())
                      if (nextIds.length === 0) return { mode: 'all', accountIds: [] }
                      return { mode: 'selected', accountIds: nextIds }
                    })
                  }}
                />
              ))}
            </FilterDropdown>
          </div>

          {/* Row 2: time | category | tag | type | amount | clear */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-500 text-xs">Time:</span>
            <select
              value={datePreset}
              onChange={e => setDatePreset(e.target.value as DateFilterPreset)}
              className={clsx(
                'bg-surface-700 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none transition-colors',
                datePreset !== 'last3Months' ? 'border border-amber-400/40 bg-amber-400/5 text-amber-300' : 'border border-white/[0.08]'
              )}
            >
              <option value="last3Months">Last 3 Months</option>
              <option value="thisMonth">This Month</option>
              <option value="lastMonth">Last Month</option>
              <option value="pastYear">Past Year</option>
              <option value="custom">Custom range...</option>
            </select>
            <span className="text-ink-500 text-xs">Category:</span>
            <FilterDropdown
              disabled={!categories?.length}
              isActive={categoryFilter.mode === 'selected' && (categoryFilter.categoryIds.length > 0 || categoryFilter.includeUncategorized)}
              buttonLabel={(() => {
                if (categoryFilter.mode === 'all') return 'All categories'
                const count = categoryFilter.categoryIds.length + (categoryFilter.includeUncategorized ? 1 : 0)
                if (count <= 0) return 'All categories'
                if (count === 1 && categoryFilter.includeUncategorized) return 'Uncategorized'
                if (count === 1 && categoryFilter.categoryIds.length === 1) return categoryNameById.get(categoryFilter.categoryIds[0]) ?? '1 category'
                return `${count} selected`
              })()}
            >
              <CheckboxRow
                checked={categoryFilter.mode === 'all'}
                label="All categories"
                onToggle={() => setCategoryFilter({ mode: 'all', categoryIds: [], includeUncategorized: false })}
                bold
              />
              <div className="h-px bg-white/[0.06] my-1" />
              <CheckboxRow
                checked={categoryFilter.mode === 'selected' && categoryFilter.includeUncategorized}
                label="Uncategorized"
                onToggle={() => {
                  setCategoryFilter(prev => {
                    const next = {
                      mode: (prev.mode === 'all' ? 'selected' : prev.mode) as 'all' | 'selected',
                      categoryIds: prev.categoryIds,
                      includeUncategorized: !prev.includeUncategorized,
                    }
                    if (next.mode === 'selected' && next.categoryIds.length === 0 && !next.includeUncategorized) {
                      return { mode: 'all', categoryIds: [], includeUncategorized: false }
                    }
                    return next
                  })
                }}
              />
              <div className="h-px bg-white/[0.06] my-1" />
              {(() => {
                const groupOrder = ['Income', 'Essential', 'Utilities', 'Lifestyle', 'Financial', 'Other']
                const parents = (categories ?? []).filter(c => c.children.length > 0)
                  .sort((a, b) => {
                    const aIdx = groupOrder.indexOf(a.name)
                    const bIdx = groupOrder.indexOf(b.name)
                    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
                  })

                const selectedSet = new Set(categoryFilter.mode === 'selected' ? categoryFilter.categoryIds : [])

                return parents.map(parent => {
                  const children = sortCategoryChildren(parent.name, parent.children)
                  const childIds = children.map(c => c.id)
                  const selectedCount = childIds.filter(id => selectedSet.has(id)).length
                  const allSelected = selectedCount > 0 && selectedCount === childIds.length
                  const someSelected = selectedCount > 0 && selectedCount < childIds.length

                  return (
                    <div key={parent.id} className="py-1">
                      <CheckboxRow
                        checked={categoryFilter.mode === 'selected' && allSelected}
                        indeterminate={categoryFilter.mode === 'selected' && someSelected}
                        label={parent.name}
                        sublabel={`${selectedCount}/${childIds.length} selected`}
                        bold
                        onToggle={() => {
                          setCategoryFilter(prev => {
                            const prevSet = new Set(prev.mode === 'selected' ? prev.categoryIds : [])
                            const nextSet = new Set(prevSet)
                            const isAllSelected = childIds.every(id => prevSet.has(id))

                            if (isAllSelected) {
                              for (const id of childIds) nextSet.delete(id)
                            } else {
                              for (const id of childIds) nextSet.add(id)
                            }

                            const nextCategoryIds = Array.from(nextSet.values()).sort((a, b) => a - b)
                            const nextMode: 'all' | 'selected' =
                              (nextCategoryIds.length === 0 && !prev.includeUncategorized) ? 'all' : 'selected'

                            return {
                              mode: nextMode,
                              categoryIds: nextMode === 'all' ? [] : nextCategoryIds,
                              includeUncategorized: prev.includeUncategorized,
                            }
                          })
                        }}
                      />
                      <div className="pl-6">
                        {children.map(child => (
                          <CheckboxRow
                            key={child.id}
                            checked={categoryFilter.mode === 'selected' && selectedSet.has(child.id)}
                            label={child.name}
                            onToggle={() => {
                              setCategoryFilter(prev => {
                                const prevSet = new Set(prev.mode === 'selected' ? prev.categoryIds : [])
                                if (prevSet.has(child.id)) prevSet.delete(child.id)
                                else prevSet.add(child.id)

                                const nextCategoryIds = Array.from(prevSet.values()).sort((a, b) => a - b)
                                const nextMode: 'all' | 'selected' =
                                  (nextCategoryIds.length === 0 && !prev.includeUncategorized) ? 'all' : 'selected'

                                return {
                                  mode: nextMode,
                                  categoryIds: nextMode === 'all' ? [] : nextCategoryIds,
                                  includeUncategorized: prev.includeUncategorized,
                                }
                              })
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })
              })()}
            </FilterDropdown>
            {excludedCfCategoryKeys.length > 0 && (
              <button
                type="button"
                onClick={() => setExcludedCfCategoryKeys([])}
                className="text-2xs px-2 py-1 rounded-full bg-surface-700 border border-white/[0.08] text-ink-300 hover:text-ink-100 transition-colors"
                title="Clear cash flow excluded categories"
              >
                Excluding {excludedCfCategoryKeys.length}
              </button>
            )}
            <span className="text-ink-500 text-xs">Tag:</span>
            <FilterDropdown
              isActive={tagFilter.mode === 'selected' && tagFilter.tags.length > 0}
              buttonLabel={(() => {
                if (tagFilter.mode === 'any') return 'All tags'
                if (tagFilter.tags.length === 1) {
                  const t = tagFilter.tags[0]
                  return t === 'is_transfer' ? 'Transfer'
                    : t === 'exclude_from_budget' ? 'Excluded'
                    : t === 'is_annualized' ? 'Annualized'
                    : 'Pending'
                }
                return `${tagFilter.tags.length} selected`
              })()}
            >
              <CheckboxRow
                checked={tagFilter.mode === 'any'}
                label="All tags"
                onToggle={() => setTagFilter({ mode: 'any', tags: [] })}
                bold
              />
              <div className="h-px bg-white/[0.06] my-1" />
              {[
                { key: 'is_transfer' as const, label: 'Transfer' },
                { key: 'exclude_from_budget' as const, label: 'Excluded' },
                { key: 'is_annualized' as const, label: 'Annualized' },
                { key: 'is_pending' as const, label: 'Pending' },
              ].map(opt => (
                <CheckboxRow
                  key={opt.key}
                  checked={tagFilter.mode === 'selected' && tagFilter.tags.includes(opt.key)}
                  label={opt.label}
                  onToggle={() => {
                    setTagFilter(prev => {
                      const set = new Set(prev.mode === 'selected' ? prev.tags : [])
                      if (set.has(opt.key)) set.delete(opt.key)
                      else set.add(opt.key)
                      const nextTags = Array.from(set.values())
                      if (nextTags.length === 0) return { mode: 'any', tags: [] }
                      return { mode: 'selected', tags: nextTags }
                    })
                  }}
                />
              ))}
            </FilterDropdown>
            <span className="text-ink-500 text-xs">Amount:</span>
            <select
              value={filters.transaction_type ?? ''}
              onChange={e => setFilters(f => ({ ...f, transaction_type: e.target.value as 'debit' | 'credit' | undefined || undefined }))}
              className={clsx(
                'bg-surface-700 rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none transition-colors',
                filters.transaction_type !== undefined ? 'border border-amber-400/40 bg-amber-400/5 text-amber-300' : 'border border-white/[0.08]'
              )}
            >
              <option value="">All types</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Min $"
                value={filters.min_amount ?? ''}
                onChange={e => setFilters(f => ({ ...f, min_amount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                onWheel={e => (e.target as HTMLInputElement).blur()}
                className={clsx(
                  'w-24 bg-surface-700 rounded-lg px-3 py-2 text-sm font-mono text-ink-100 placeholder-ink-400 focus:outline-none transition-colors',
                  filters.min_amount !== undefined ? 'border border-amber-400/40 bg-amber-400/5' : 'border border-white/[0.08]'
                )}
              />
              <span className="text-ink-500 text-xs">-</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Max $"
                value={filters.max_amount ?? ''}
                onChange={e => setFilters(f => ({ ...f, max_amount: e.target.value ? parseFloat(e.target.value) : undefined }))}
                onWheel={e => (e.target as HTMLInputElement).blur()}
                className={clsx(
                  'w-24 bg-surface-700 rounded-lg px-3 py-2 text-sm font-mono text-ink-100 placeholder-ink-400 focus:outline-none transition-colors',
                  filters.max_amount !== undefined ? 'border border-amber-400/40 bg-amber-400/5' : 'border border-white/[0.08]'
                )}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={clearFilters} className={clsx(!hasActiveFilters && 'opacity-40')}>
              Clear
            </Button>
          </div>

          {/* Custom date range (shown inline below row 2 when selected) */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 pl-0">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className={clsx(
                  'bg-surface-700 rounded-lg px-3 py-1.5 text-sm text-ink-100 focus:outline-none transition-colors',
                  customFrom ? 'border border-amber-400/40 bg-amber-400/5' : 'border border-white/[0.08]'
                )}
              />
              <span className="text-ink-400 text-sm">to</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className={clsx(
                  'bg-surface-700 rounded-lg px-3 py-1.5 text-sm text-ink-100 focus:outline-none transition-colors',
                  customTo ? 'border border-amber-400/40 bg-amber-400/5' : 'border border-white/[0.08]'
                )}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Transactions grouped by month */}
      <Card padding={false}>
        <div className="px-5 py-3 border-b border-white/[0.06]">
          <span className="label">Transactions</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : !filteredTransactions?.length ? (
          <div className="p-5">
            <EmptyState
              title="No transactions found"
              description="Try adjusting your filters or date range."
            />
          </div>
        ) : (
          <div>
            {transactionsByMonth.map((group, groupIdx) => (
              <div key={group.month}>
                {/* Month header */}
                <div className={clsx(
                  'sticky top-[var(--page-header-height,0px)] z-10 flex items-center justify-between px-5 py-2 bg-surface-800 border-b border-white/[0.06]',
                  groupIdx > 0 && 'border-t border-white/[0.08]'
                )}>
                  <span className="text-sm font-semibold text-ink-100">{group.label}</span>
                  <span className="text-xs text-ink-300 font-mono">
                    {group.transactions.length} transaction{group.transactions.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Transactions in this month */}
                <div className="divide-y divide-white/[0.04]">
                  {group.transactions.map(tx => (
                    <div key={tx.id}>
                      {/* Mobile layout */}
                      <div
                        onClick={() => setEditTx(tx)}
                        className="md:hidden grid grid-cols-2 gap-x-2 gap-y-1 items-start px-4 py-3 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      >
                        <div className="text-sm text-ink-100 truncate min-w-0">
                          {tx.description || tx.original_description}
                        </div>
                        <div className="text-right">
                          <span className={clsx('font-mono text-sm', tx.transaction_type === 'credit' ? 'text-teal-400' : 'text-ink-100')}>
                            {tx.transaction_type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                          </span>
                        </div>
                        <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs text-ink-400 flex-shrink-0">{formatShortDate(tx.date)}</span>
                          {tx.account_name && <span className="text-2xs text-ink-400 truncate">· {tx.account_name}</span>}
                        </div>
                        <div className="text-right flex flex-col items-end gap-1">
                          {tx.category_name && <span className="badge badge-ink text-2xs">{tx.category_name}</span>}
                          {(tx.is_transfer || tx.exclude_from_budget || tx.is_annualized || tx.is_pending || tx.date > todayStr) && (
                            <div className="flex gap-1 flex-wrap justify-end">
                              {tx.is_transfer && <span className="badge badge-amber text-2xs">transfer</span>}
                              {tx.exclude_from_budget && <span className="badge badge-amber text-2xs">excluded</span>}
                              {tx.is_annualized && <span className="badge badge-teal text-2xs">annualized</span>}
                              {(tx.date > todayStr || tx.is_pending) && (
                                <span className={clsx('text-2xs', tx.date > todayStr ? 'badge badge-blue' : 'badge badge-amber')}>pending</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Desktop layout */}
                      <div
                        onClick={() => setEditTx(tx)}
                        className="hidden md:flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] cursor-pointer transition-colors"
                      >
                        <div className="w-16 flex-shrink-0">
                          <span className="font-mono text-xs text-ink-300">{formatShortDate(tx.date)}</span>
                        </div>
                        <div className="flex-[2] min-w-0">
                          <div className="text-sm text-ink-100 truncate">{tx.description || tx.original_description}</div>
                          {tx.account_name && <div className="text-2xs text-ink-300 mt-0.5">{tx.account_name}</div>}
                        </div>
                        <div className="flex-[1] min-w-0">
                          {tx.notes
                            ? <span className="text-xs text-ink-300 truncate block" title={tx.notes}>{tx.notes}</span>
                            : <span className="text-ink-600 text-xs"></span>}
                        </div>
                        <div className="w-28 flex-shrink-0">
                          {tx.category_name
                            ? <span className="badge badge-ink text-2xs">{tx.category_name}</span>
                            : <span className="text-ink-500 text-xs">-</span>}
                        </div>
                        <div className="w-24 flex-shrink-0 flex gap-1 flex-wrap">
                          {tx.is_transfer && <span className="badge badge-amber text-2xs">transfer</span>}
                          {tx.exclude_from_budget && <span className="badge badge-amber text-2xs">excluded</span>}
                          {tx.is_annualized && <span className="badge badge-teal text-2xs">annualized</span>}
                          {(tx.date > todayStr || tx.is_pending) && (
                            <span className={clsx('text-2xs', tx.date > todayStr ? 'badge badge-blue' : 'badge badge-amber')}>pending</span>
                          )}
                        </div>
                        <div className="w-24 text-right flex-shrink-0">
                          <span className={clsx('font-mono text-sm', tx.transaction_type === 'credit' ? 'text-teal-400' : 'text-ink-100')}>
                            {tx.transaction_type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showAdd && accounts && categories && (
        <AddTransactionModal
          accounts={accounts}
          categories={categories}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editTx && categories && (
        <EditTransactionModal
          tx={editTx}
          categories={categories}
          onClose={() => setEditTx(null)}
        />
      )}
    </div>
  )
}













