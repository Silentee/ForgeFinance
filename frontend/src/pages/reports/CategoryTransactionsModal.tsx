import { useCategoryTransactions } from '@/hooks'
import { Modal, Spinner } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/format'
import clsx from 'clsx'

export interface CategoryDrilldown {
  title: string
  categoryIds: number[]
  includeUncategorized: boolean
}

// The transactions behind one Spending-report row for a month: the same
// selection the budget report sums, so the total here equals that row.
export default function CategoryTransactionsModal({ year, month, drilldown, onClose }: {
  year: number
  month: number
  drilldown: CategoryDrilldown
  onClose: () => void
}) {
  const { data, isLoading } = useCategoryTransactions(year, month, {
    categoryIds: drilldown.categoryIds,
    includeUncategorized: drilldown.includeUncategorized,
  })
  const lines = data?.lines ?? []
  // A parent group spans several categories, so each line names its own.
  const multiCategory = drilldown.categoryIds.length + (drilldown.includeUncategorized ? 1 : 0) > 1

  // `!` so the width beats Modal's base max-w-md, which Tailwind emits later in the stylesheet.
  return (
    <Modal onClose={onClose} className="!max-w-4xl">
      <h2 className="text-base font-semibold text-ink-100 mb-1 pr-6">{drilldown.title}</h2>
      <p className="text-sm text-ink-300 mb-4">
        {data
          ? `${data.month_label} · ${lines.length} transaction${lines.length === 1 ? '' : 's'}`
          : ' '}
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !data || lines.length === 0 ? (
        <div className="py-10 text-center text-sm text-ink-400">
          No transactions counted toward this category this month
        </div>
      ) : (
        <div className="border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {lines.map(line => (
              <div key={line.transaction_id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="hidden sm:block w-24 flex-shrink-0 font-mono text-xs text-ink-300 pt-0.5">
                  {formatDate(line.date)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-100 truncate" title={line.description}>{line.description}</div>
                  {line.notes && (
                    <div className="text-xs text-ink-300 mt-0.5 whitespace-pre-line break-words">{line.notes}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-2xs text-ink-300">
                    <span className="sm:hidden font-mono">{formatDate(line.date)}</span>
                    {line.account_name && <span>{line.account_name}</span>}
                    {multiCategory && (
                      <span className="badge badge-ink text-2xs">{line.category_name ?? 'Uncategorized'}</span>
                    )}
                    {line.is_annualized && <span className="badge badge-teal text-2xs">annualized</span>}
                  </div>
                  {line.is_annualized && (
                    <div className="text-2xs text-ink-400 font-mono mt-0.5">
                      1/12 of {formatCurrency(line.amount)} · month {line.annualized_month} of 12
                    </div>
                  )}
                </div>
                <span className={clsx(
                  'w-24 flex-shrink-0 text-right font-mono text-sm',
                  line.contribution < 0 ? 'text-teal-400' : 'text-ink-100'
                )}>
                  {formatCurrency(line.contribution)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/[0.08] bg-white/[0.03]">
            <span className="text-sm font-medium text-ink-100">Total</span>
            <span className="font-mono text-sm text-ink-100">{formatCurrency(data.total)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
