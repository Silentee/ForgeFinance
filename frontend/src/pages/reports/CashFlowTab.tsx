import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSpendingTrends } from '@/hooks'
import { Card, CardHeader, Spinner } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencyCompact, formatCurrencySignedWhole, currentYearMonth } from '@/lib/format'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import clsx from 'clsx'
import { type YearMonth, compareYearMonth, diffMonths, addMonths, yearMonthToInput, parseYearMonthInput } from './shared'

export default function CashFlowTab() {
  const now = currentYearMonth()
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

  const { data: cfTrends, isLoading: cfLoading } = useSpendingTrends({ months: cfMonths, year: cfAnchor.year, month: cfAnchor.month, top_n: 50 })

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
}
