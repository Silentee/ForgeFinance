import { useState } from 'react'
import { useSpendingTrends, useAccounts } from '@/hooks'
import { Card, Spinner } from '@/components/ui'
import { formatCurrencyWhole, currentYearMonth } from '@/lib/format'
import clsx from 'clsx'

export default function EmergencyFundTab() {
  const now = currentYearMonth()
  const [excludedEmergencyCategories, setExcludedEmergencyCategories] = useState<Set<string>>(new Set())
  const [includeAllLiquidAssets, setIncludeAllLiquidAssets] = useState(true)
  const [emergencyTargetMinMonths, setEmergencyTargetMinMonths] = useState<number | ''>(3)
  const [emergencyTargetMaxMonths, setEmergencyTargetMaxMonths] = useState<number | ''>(6)

  const emergencyAnchorDate = new Date(now.year, now.month - 1, 1)
  emergencyAnchorDate.setMonth(emergencyAnchorDate.getMonth() - 1)
  const emergencyAnchorYear = emergencyAnchorDate.getFullYear()
  const emergencyAnchorMonth = emergencyAnchorDate.getMonth() + 1

  const { data: accounts } = useAccounts({ active_only: false })
  const { data: emergencyTrends, isLoading: emergencyLoading } = useSpendingTrends({ months: 12, top_n: 20, year: emergencyAnchorYear, month: emergencyAnchorMonth })

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
      return { minTarget, maxTarget, status: 'under' as const, delta: minTarget - emergencyFundBase }
    }
    if (emergencyFundBase > maxTarget) {
      return { minTarget, maxTarget, status: 'over' as const, delta: emergencyFundBase - maxTarget }
    }
    return { minTarget, maxTarget, status: 'within' as const, delta: 0 }
  }

  const toggleEmergencyCategory = (key: string) => {
    setExcludedEmergencyCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
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
                              {formatCurrencyWhole(mean)}{delta >= 1 ? ` ±${formatCurrencyWhole(delta)}` : ''}/mo
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
  )
}
