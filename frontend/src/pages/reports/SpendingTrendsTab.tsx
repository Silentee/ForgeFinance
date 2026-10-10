import { useMemo, useState } from 'react'
import { useCategoryTrends, useCategories } from '@/hooks'
import { Card, CategoryFilterDropdown, Spinner, type CategoryFilter } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencyCompact, formatCurrencySignedWhole, currentYearMonth } from '@/lib/format'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import clsx from 'clsx'
import { addMonths, niceTicks } from './shared'

const WINDOWS = [
  { months: 3, label: '3M' },
  { months: 6, label: '6M' },
  { months: 12, label: '1Y' },
]

const SPEND_COLOR = '#f5a623'
const BUDGET_COLOR = '#a8a29e'

export default function SpendingTrendsTab() {
  // Anchor to the last complete month so a partial month doesn't read as a dip.
  const anchor = addMonths(currentYearMonth(), -1)
  const [months, setMonths] = useState(6)
  const [overlayBudget, setOverlayBudget] = useState(true)
  // null = untouched; the default (everything selected) applies.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter | null>(null)

  const { data: trends, isLoading } = useCategoryTrends({ months, year: anchor.year, month: anchor.month })
  const { data: categories } = useCategories({ expense_only: true })

  const knownChildIds = useMemo(
    () => new Set((categories ?? []).flatMap(p => p.children.map(c => c.id))),
    [categories]
  )
  const defaultFilter = useMemo<CategoryFilter | null>(
    () => (categories ? { categoryIds: Array.from(knownChildIds), includeUncategorized: true } : null),
    [categories, knownChildIds]
  )
  const effectiveFilter = categoryFilter ?? defaultFilter

  // Same rule as the Subscriptions filter: ids the picker doesn't list
  // (uncategorized, hidden or childless categories) follow the Uncategorized box.
  const matchesFilter = (categoryId?: number | null) => {
    if (!effectiveFilter) return true
    if (categoryId != null && knownChildIds.has(categoryId)) return effectiveFilter.categoryIds.includes(categoryId)
    return effectiveFilter.includeUncategorized
  }

  const selectedSeries = (trends?.series ?? []).filter(s => matchesFilter(s.category_id))
  const labels = trends?.month_labels ?? []
  // A month where none of the selected categories has a budget is "no budget",
  // not a $0 budget — null leaves a gap in the dotted line instead of a plunge.
  const chartData = labels.map((label, i) => {
    const budget = selectedSeries.reduce((sum, s) => sum + (s.budgets[i] ?? 0), 0)
    return {
      label,
      spend: Math.round(selectedSeries.reduce((sum, s) => sum + (s.actuals[i] ?? 0), 0) * 100) / 100,
      budget: budget !== 0 ? Math.round(budget * 100) / 100 : null,
    }
  })

  const budgetedMonths = chartData.filter(d => d.budget != null)
  const hasBudget = budgetedMonths.length > 0
  const showBudget = overlayBudget && hasBudget
  const monthCount = chartData.length
  const totalSpend = chartData.reduce((sum, d) => sum + d.spend, 0)
  const avgSpend = monthCount > 0 ? totalSpend / monthCount : 0
  // Budget figures only cover months that have a budget, so unbudgeted
  // months don't read as overspending.
  const totalBudget = budgetedMonths.reduce((sum, d) => sum + d.budget!, 0)
  const avgBudget = hasBudget ? totalBudget / budgetedMonths.length : 0
  const underBudget = budgetedMonths.reduce((sum, d) => sum + d.budget! - d.spend, 0)

  const plotted = chartData.flatMap(d => (showBudget && d.budget != null ? [d.spend, d.budget] : [d.spend]))
  const { domain, ticks } = niceTicks(Math.min(0, ...plotted), Math.max(0, ...plotted))

  const nothingSelected = effectiveFilter != null && effectiveFilter.categoryIds.length === 0 && !effectiveFilter.includeUncategorized

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
          <span className="text-ink-500">Categories:</span>
          <CategoryFilterDropdown
            categories={categories}
            value={categoryFilter}
            defaultValue={defaultFilter}
            onChange={setCategoryFilter}
          />
          <button
            type="button"
            onClick={() => setOverlayBudget(v => !v)}
            className={clsx(
              'bg-surface-700 rounded-lg px-3 py-2 text-sm transition-colors border',
              overlayBudget
                ? 'border-amber-400/40 bg-amber-400/5 text-amber-300'
                : 'border-white/[0.08] text-ink-100'
            )}
          >
            Overlay budget
          </button>
        </div>
        <div className="flex gap-0.5 bg-surface-800 border border-white/[0.06] rounded-lg p-0.5">
          {WINDOWS.map(w => (
            <button
              key={w.months}
              onClick={() => setMonths(w.months)}
              className={clsx(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                months === w.months ? 'bg-surface-600 text-ink-100' : 'text-ink-400 hover:text-ink-200'
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : nothingSelected ? (
        <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
          Select at least one category
        </div>
      ) : monthCount > 0 ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="flex flex-col gap-1">
              <span className="label text-ink-200">Avg spend</span>
              <span className="stat-value">
                {formatCurrencyWhole(avgSpend)}
                <span className="text-ink-300 text-xs font-normal ml-1">/mo</span>
              </span>
              <span className="text-xs text-ink-300 font-mono">{formatCurrencyWhole(totalSpend)} total</span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="label text-ink-200">Avg budget</span>
              <span className="stat-value">
                {hasBudget ? formatCurrencyWhole(avgBudget) : '—'}
                {hasBudget && <span className="text-ink-300 text-xs font-normal ml-1">/mo</span>}
              </span>
              <span className="text-xs text-ink-300 font-mono">
                {hasBudget ? `${formatCurrencyWhole(totalBudget)} total` : 'No budget set'}
              </span>
            </Card>
            <Card className="flex flex-col gap-1">
              <span className="label text-ink-200">{underBudget >= 0 ? 'Under budget' : 'Over budget'}</span>
              <span className={clsx('stat-value', hasBudget && (underBudget >= 0 ? 'value-positive' : 'value-negative'))}>
                {hasBudget ? formatCurrencySignedWhole(underBudget) : '—'}
              </span>
              <span className="text-xs text-ink-300 font-mono">
                {hasBudget
                  ? `across ${budgetedMonths.length} budgeted month${budgetedMonths.length === 1 ? '' : 's'}`
                  : 'No budget set'}
              </span>
            </Card>
          </div>

          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#8a8580', fontSize: 11, fontFamily: 'DM Mono' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={domain}
                  ticks={ticks}
                  tick={{ fill: '#8a8580', fontSize: 11, fontFamily: 'DM Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatCurrencyCompact(v)}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof chartData)[number]
                    return (
                      <div
                        className="px-3 py-2 text-xs"
                        style={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono' }}
                      >
                        <div className="text-ink-100 mb-1">{label}</div>
                        <div style={{ color: SPEND_COLOR }}>Spend: {formatCurrencyWhole(d.spend)}</div>
                        {showBudget && (d.budget != null ? (
                          <>
                            <div style={{ color: BUDGET_COLOR }}>Budget: {formatCurrencyWhole(d.budget)}</div>
                            <div className={d.budget - d.spend >= 0 ? 'value-positive' : 'value-negative'}>
                              {d.budget - d.spend >= 0 ? 'Under' : 'Over'}: {formatCurrencySignedWhole(d.budget - d.spend)}
                            </div>
                          </>
                        ) : (
                          <div className="text-ink-500">No budget set</div>
                        ))}
                      </div>
                    )
                  }}
                />
                {showBudget && (
                  <Line
                    dataKey="budget"
                    type="monotone"
                    stroke={BUDGET_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={{ r: 4, fill: BUDGET_COLOR, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                )}
                <Line
                  dataKey="spend"
                  type="monotone"
                  stroke={SPEND_COLOR}
                  strokeWidth={2}
                  dot={{ r: 3, fill: SPEND_COLOR, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: SPEND_COLOR, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-center gap-5 text-xs text-ink-300">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-5 h-0.5" style={{ background: SPEND_COLOR }} />
              Spend
            </span>
            {showBudget && (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: BUDGET_COLOR }} />
                Budget
              </span>
            )}
            {overlayBudget && !hasBudget && <span className="text-ink-500">No budget set for these categories</span>}
          </div>
        </div>
      ) : (
        <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
          No spending data yet
        </div>
      )}
    </Card>
  )
}
