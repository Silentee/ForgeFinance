import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { formatCurrency, formatCurrencyWhole, formatCurrencySigned, formatPercent, clampPercent } from '@/lib/format'

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  children: React.ReactNode
  onClose: () => void
  className?: string
}

export function Modal({ children, onClose, className }: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-3 sm:p-4">
      <div className={clsx('card w-full max-w-md p-5 animate-slide-up relative max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] overflow-y-auto', className)}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-400 hover:text-ink-100 transition-colors"
          aria-label="Close"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
          </svg>
        </button>
        {children}
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={clsx('card', padding && 'p-5', className)}>
      {children}
    </div>
  )
}

// ─── Section header inside a card ─────────────────────────────────────────────

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="label">{title}</h2>
      {action}
    </div>
  )
}

// ─── StatCard — the primary KPI tile ─────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number | undefined | null
  format?: 'currency' | 'signed' | 'percent'
  wholeDollars?: boolean
  amber?: boolean
  positive?: boolean    // force green
  negative?: boolean    // force red
  autoSign?: boolean    // positive=green, negative=red based on value
  trend?: number        // optional trend value shown below
  trendLabel?: string
  loading?: boolean
  className?: string
}

export function StatCard({
  label, value, format = 'currency',
  wholeDollars, positive, negative, autoSign, amber,
  trend, trendLabel, loading, className,
}: StatCardProps) {
  const formatValue = (v: number) => {
    if (format === 'signed') return wholeDollars
      ? (v > 0 ? `+${formatCurrencyWhole(v)}` : v < 0 ? `-${formatCurrencyWhole(Math.abs(v))}` : formatCurrencyWhole(v))
      : formatCurrencySigned(v)
    if (format === 'percent') return formatPercent(v)
    return wholeDollars ? formatCurrencyWhole(v) : formatCurrency(v)
  }

  const colorClass = amber
    ? 'text-amber-400'
    : positive
    ? 'value-positive'
    : negative
    ? 'value-negative'
    : autoSign && value != null
    ? value >= 0 ? 'value-positive' : 'value-negative'
    : 'value-neutral'

  return (
    <Card className={clsx('flex flex-col gap-1', className)}>
      <span className="label">{label}</span>
      {loading ? (
        <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
      ) : (
        <span className={clsx('stat-value', colorClass)}>
          {value != null ? formatValue(value) : '—'}
        </span>
      )}
      {trend != null && (
        <span className={clsx('text-xs font-mono mt-0.5', trend >= 0 ? 'text-teal-400' : 'text-rose-400')}>
          {wholeDollars
            ? (trend > 0 ? `+${formatCurrencyWhole(trend)}` : trend < 0 ? `-${formatCurrencyWhole(Math.abs(trend))}` : formatCurrencyWhole(trend))
            : formatCurrencySigned(trend)}
          {trendLabel && <span className="text-ink-400 ml-1">{trendLabel}</span>}
        </span>
      )}
    </Card>
  )
}

// ─── Budget progress bar row ──────────────────────────────────────────────────

interface BudgetBarProps {
  label: string
  actual: number
  budgeted: number
  percentUsed?: number
  invertColors?: boolean  // For income: over=good, under=bad
}

export function BudgetBar({ label, actual, budgeted, percentUsed, invertColors }: BudgetBarProps) {
  const pct = clampPercent(percentUsed ?? (budgeted > 0 ? (actual / budgeted) * 100 : 0))
  const isOver = pct >= 100

  // For expenses: over=red, near=amber, under=green
  // For income (inverted): over=green, near=amber, under=red
  const getBarColor = () => {
    if (invertColors) {
      // Income: green when over target, red when under
      return isOver ? 'bg-teal-400' : pct > 80 ? 'bg-amber-400' : 'bg-rose-400'
    }
    // Expenses: red when over, green when under
    return isOver ? 'bg-rose-500' : pct > 80 ? 'bg-amber-400' : 'bg-teal-400'
  }

  const textColor = invertColors
    ? (isOver ? 'text-teal-400' : 'text-ink-200')
    : (isOver ? 'text-rose-400' : 'text-ink-200')

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-200 truncate mr-2">{label}</span>
        <span className={clsx('font-mono flex-shrink-0', textColor)}>
          {formatCurrencyWhole(actual)} / {formatCurrencyWhole(budgeted)}
        </span>
      </div>
      <div className="h-1 bg-surface-700 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', getBarColor())}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}

export function Button({
  variant = 'secondary', size = 'md',
  loading, disabled, children, className, ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary:   'bg-amber-400 text-surface-950 hover:bg-amber-500 shadow-glow-amber',
    secondary: 'bg-surface-700 text-ink-100 border border-white/[0.08] hover:bg-surface-600',
    ghost:     'text-ink-300 hover:text-ink-100 hover:bg-white/[0.04]',
    danger:    'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  }

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], className)}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' }[size]
  return (
    <svg className={clsx(s, 'animate-spin text-amber-400')} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-ink-400 mb-4 opacity-40">{icon}</div>}
      <p className="text-ink-200 font-medium">{title}</p>
      {description && <p className="text-sm text-ink-300 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, action, extra }: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  extra?: React.ReactNode
}) {
  const headerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = headerRef.current
    if (!el) return

    const setHeightVar = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      const mobileBarPx = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--mobile-bar-height') || '0'
      )
      document.documentElement.style.setProperty('--page-header-height', `${height + (mobileBarPx || 0)}px`)
    }

    setHeightVar()
    const observer = new ResizeObserver(setHeightVar)
    observer.observe(el)
    window.addEventListener('resize', setHeightVar)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', setHeightVar)
    }
  }, [])

  return (
    <div
      ref={headerRef}
      className="sticky top-[var(--mobile-bar-height)] md:top-0 z-30 -mx-4 md:-mx-6 mb-6 border-b border-white/[0.06] bg-surface-950/95 px-4 md:px-6 py-4 backdrop-blur"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink-100">{title}</h1>
          {subtitle && <p className="text-sm text-ink-300 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {extra && <div className="mt-3">{extra}</div>}
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('bg-surface-700 rounded animate-pulse', className)} />
}

// ─── Account type color dot ───────────────────────────────────────────────────

export function AccountTypeDot({ isLiability }: { type?: string; isLiability?: boolean }) {
  return (
    <span className={clsx(
      'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
      isLiability ? 'bg-rose-400' : 'bg-teal-400'
    )} />
  )
}

// ─── Simple data table ────────────────────────────────────────────────────────

interface Column<T> {
  header: string
  accessor: (row: T) => React.ReactNode
  align?: 'left' | 'right'
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyFn: (row: T) => string | number
  onRowClick?: (row: T) => void
  loading?: boolean
  emptyMessage?: string
}

export function Table<T>({ columns, data, keyFn, onRowClick, loading, emptyMessage }: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {columns.map((col, i) => (
              <th
                key={i}
                className={clsx(
                  'py-2.5 px-3 label text-left first:pl-0 last:pr-0',
                  col.align === 'right' && 'text-right'
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((_, j) => (
                  <td key={j} className="py-3 px-3 first:pl-0 last:pr-0">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-ink-300 text-xs">
                {emptyMessage ?? 'No data'}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={keyFn(row)}
                onClick={() => onRowClick?.(row)}
                className={clsx(
                  'transition-colors duration-100',
                  onRowClick && 'cursor-pointer hover:bg-white/[0.02]'
                )}
              >
                {columns.map((col, i) => (
                  <td
                    key={i}
                    className={clsx(
                      'py-3 px-3 first:pl-0 last:pr-0',
                      col.align === 'right' && 'text-right',
                      col.className
                    )}
                  >
                    {col.accessor(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}





