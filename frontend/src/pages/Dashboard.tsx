import { Link } from 'react-router-dom'
import {
  useNetWorth, useNetWorthHistory, useMonthlyTotals, useAccounts,
  useSpendingTrends, useCategories,
} from '@/hooks'
import { StatCard, Card, CardHeader, PageHeader } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencySignedWhole, formatCurrencyCompact, currentYearMonth, formatMonthYear } from '@/lib/format'
import {
  AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'
import clsx from 'clsx'

const { month, year } = currentYearMonth()
const prevMonth = month === 1 ? 12 : month - 1
const prevYear = month === 1 ? year - 1 : year

const CHART_COLORS = [
  '#f5a623', '#34d4b1', '#f87171', '#818cf8',
  '#fb923c', '#a78bfa', '#22d3ee', '#4ade80', '#f472b6',
]

export default function Dashboard() {
  const { data: netWorth, isLoading: nwLoading } = useNetWorth()
  const { data: nwHistory } = useNetWorthHistory(13)
  const { data: cfTotals } = useMonthlyTotals({ months: 3, year: prevYear, month: prevMonth })
  const { data: accounts } = useAccounts({ active_only: true })

  // Spending trends for previous 3 months (Dec–Feb when current month is March)
  const spendAnchor = (() => {
    const d = new Date(year, month - 1, 1)
    d.setMonth(d.getMonth() - 1) // anchor to last complete month
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const { data: spendingTrends } = useSpendingTrends({ months: 3, year: spendAnchor.year, month: spendAnchor.month, top_n: 50 })
  const { data: categories } = useCategories({ expense_only: true })

  // Compute 3-month averages from monthly totals (Dec–Feb), consistent with spending/cash flow reports
  const histAvgs = (() => {
    if (!cfTotals) return null
    const inc = cfTotals.monthly_income_totals
    const exp = cfTotals.monthly_expense_totals
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const inc3 = avg(inc)
    const exp3 = avg(exp)
    const net3 = inc3 - exp3
    return { inc3, exp3, net3 }
  })()

  // Emergency fund = sum of liquid asset balances
  const emergencyFund = (() => {
    if (!accounts) return null
    return accounts
      .filter((a: { is_liquid: boolean; is_liability: boolean; is_active: boolean; include_in_net_worth: boolean }) =>
        a.is_liquid && !a.is_liability && a.is_active && a.include_in_net_worth
      )
      .reduce((sum: number, a: { current_balance?: number }) => sum + (a.current_balance ?? 0), 0)
  })()

  const monthsCoverage = emergencyFund != null && histAvgs && histAvgs.exp3 > 0
    ? emergencyFund / histAvgs.exp3
    : null

  // Build category name → parent name map from category tree
  const catParentMap = new Map<string, string>()
  for (const parent of categories ?? []) {
    for (const child of parent.children) {
      catParentMap.set(child.name, parent.name)
    }
  }

  // Pie chart: group 3-month expense totals by parent category
  const expensePieData = (() => {
    if (!spendingTrends) return []
    const groups = new Map<string, number>()
    for (const s of spendingTrends.series) {
      if (s.is_income) continue
      const parent = catParentMap.get(s.category_name) ?? 'Other'
      groups.set(parent, (groups.get(parent) ?? 0) + s.total)
    }
    return Array.from(groups.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({ name, value: Math.round(value * 100) / 100 / 3, color: CHART_COLORS[i % CHART_COLORS.length] }))
  })()

  const expensePieTotal = expensePieData.reduce((s, d) => s + d.value, 0)

  // Net worth chart data: 13 months requested, skip the last (current month) to show prior 12
  const nwAllPoints = nwHistory?.data_points ?? []
  const chartData = (nwAllPoints.length > 12 ? nwAllPoints.slice(0, -1) : nwAllPoints).map(p => ({
    date: p.date.slice(0, 7),
    net: p.net_worth,
  }))

  const nwXAxisTicks = (() => {
    if (chartData.length === 0) return undefined
    const lastIdx = chartData.length - 1
    return chartData
      .map(d => d.date)
      .filter((_, i) => (i+1) % 3 === 0 || i === lastIdx)
  })()

  const nw12mChange = chartData.length >= 2
    ? chartData[chartData.length - 1].net - chartData[0].net
    : null

  const nwTicks = (() => {
    if (chartData.length === 0) return undefined
    const vals = chartData.map(d => d.net)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = max - min || 1
    const rawStep = range / 4
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
    const norm = rawStep / mag
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
    const lo = Math.floor(min / step) * step
    const hi = Math.ceil(max / step) * step
    const ticks: number[] = []
    for (let t = lo; t <= hi + step * 0.01; t += step) ticks.push(t)
    return ticks
  })()

  // Cash flow chart data for last 3 months
  const cfChartData = (() => {
    if (!cfTotals) return []
    return cfTotals.month_labels.map((label: string, i: number) => ({
      label,
      income: Math.round(cfTotals.monthly_income_totals[i] * 100) / 100,
      expense: -Math.round(cfTotals.monthly_expense_totals[i] * 100) / 100,
      net: Math.round(cfTotals.monthly_net_totals[i] * 100) / 100,
    }))
  })()

  return (
    <div className="space-y-8 animate-slide-up">
      <PageHeader
        title="Dashboard"
        subtitle=""
      />

      {/* KPI tiles — mobile: 2-col with custom row order; desktop: 3-col */}
      {/* Mobile order: Net Worth, Total Assets, Liquid Assets, Total Liabilities, Avg Income, Avg Expenses, Avg Net, Coverage */}
      {/* Desktop order: Net Worth, Total Assets, Total Liabilities, Avg Income, Avg Expenses, Avg Net, Liquid Assets, Coverage */}
      <div className="grid grid-cols-2 gap-4 md:hidden">
        <div className="order-1">
          <StatCard label="Net Worth" value={netWorth?.net_worth} loading={nwLoading} wholeDollars />
        </div>
        <div className="order-2">
          <StatCard label="Total Assets" value={netWorth?.total_assets} loading={nwLoading} positive wholeDollars />
        </div>
        <div className="order-3">
          <Card className="flex flex-col gap-1">
            <span className="label">Liquid Assets</span>
            {emergencyFund == null ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value text-white-400">{formatCurrencyWhole(emergencyFund)}</span>
            )}
          </Card>
        </div>
        <div className="order-4">
          <StatCard label="Total Liabilities" value={netWorth?.total_liabilities} loading={nwLoading} negative wholeDollars />
        </div>
        <div className="order-5">
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Income (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value value-positive">{formatCurrencyWhole(histAvgs.inc3)}</span>
            )}
          </Card>
        </div>
        <div className="order-6">
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Expenses (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value value-negative">{formatCurrencyWhole(histAvgs.exp3)}</span>
            )}
          </Card>
        </div>
        <div className="order-7">
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Net (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className={clsx('stat-value', histAvgs.net3 >= 0 ? 'value-positive' : 'value-negative')}>
                {formatCurrencySignedWhole(histAvgs.net3)}
              </span>
            )}
          </Card>
        </div>
        <div className="order-8">
          <Card className="flex flex-col gap-1">
            <span className="label">Expense Coverage</span>
            {monthsCoverage == null ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className={clsx('stat-value', monthsCoverage < 3 ? 'text-rose-400' : monthsCoverage > 6 ? 'text-amber-400' : 'text-teal-400')}>
                {monthsCoverage.toFixed(1)} mo
              </span>
            )}
          </Card>
        </div>
      </div>

      <div className="hidden md:block space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Net Worth" value={netWorth?.net_worth} loading={nwLoading} wholeDollars />
          <StatCard label="Total Assets" value={netWorth?.total_assets} loading={nwLoading} positive wholeDollars />
          <StatCard label="Total Liabilities" value={netWorth?.total_liabilities} loading={nwLoading} negative wholeDollars />
        </div>

        <div className="grid grid-cols-5 gap-4">
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Income (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value value-positive">{formatCurrencyWhole(histAvgs.inc3)}</span>
            )}
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Expenses (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value value-negative">{formatCurrencyWhole(histAvgs.exp3)}</span>
            )}
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="label">Avg Net (3M)</span>
            {!histAvgs ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className={clsx('stat-value', histAvgs.net3 >= 0 ? 'value-positive' : 'value-negative')}>
                {formatCurrencySignedWhole(histAvgs.net3)}
              </span>
            )}
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="label">Liquid Assets</span>
            {emergencyFund == null ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className="stat-value text-white-400">{formatCurrencyWhole(emergencyFund)}</span>
            )}
          </Card>
          <Card className="flex flex-col gap-1">
            <span className="label">Expense Coverage</span>
            {monthsCoverage == null ? (
              <div className="h-7 w-32 bg-surface-700 rounded animate-pulse mt-1" />
            ) : (
              <span className={clsx('stat-value', monthsCoverage < 3 ? 'text-rose-400' : monthsCoverage > 6 ? 'text-amber-400' : 'text-teal-400')}>
                {monthsCoverage.toFixed(1)} mo
              </span>
            )}
          </Card>
        </div>
      </div>

      {/* Net worth chart + Cash flow + Budget alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Net worth area chart — prior 12 months */}
        <Card padding={false}>
          <div className="flex items-center justify-between p-5 pb-4">
            <div className="flex flex-col gap-0.5">
              <CardHeader title="Net Worth — 12 Months" />
              {nw12mChange != null && (
                <span className={clsx('text-xs font-mono', nw12mChange >= 0 ? 'text-teal-400' : 'text-rose-400')}>
                  {formatCurrencySignedWhole(nw12mChange)}
                </span>
              )}
            </div>
            <Link to="/reports/net-worth" className="text-2xs text-amber-400 hover:text-amber-300">Details →</Link>
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5a623" stopOpacity={0.25}/>
                    <stop offset="100%" stopColor="#f5a623" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  ticks={nwXAxisTicks}
                  minTickGap={24}
                  tickMargin={8}
                  tickFormatter={(v: string) => formatMonthYear(v)}
                />
                <YAxis
                  tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  ticks={nwTicks}
                  domain={nwTicks ? [nwTicks[0], nwTicks[nwTicks.length - 1]] : ['auto', 'auto']}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                  labelStyle={{ color: '#8a8580' }}
                  formatter={(v: number) => [formatCurrencyWhole(v), '']}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                <Area type="monotone" dataKey="net" stroke="#f5a623" strokeWidth={1.5} fill="url(#netGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              No balance history yet
            </div>
          )}
        </Card>

        {/* Cash flow — last 3 months */}
        <Card padding={false}>
          <div className="flex items-center justify-between p-5 pb-2">
            <CardHeader title="Cash Flow — 3 Months" />
            <Link to="/reports/cash-flow" className="text-2xs text-amber-400 hover:text-amber-300">Details →</Link>
          </div>
          {cfChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={cfChartData} barGap={-28} margin={{ top: 4, right: 20, left: 10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
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
                  <Bar dataKey="income" fill="#34d4b1" radius={[3, 3, 0, 0]} barSize={28} />
                  <Bar dataKey="expense" fill="#f87171" radius={[0, 0, 3, 3]} barSize={28} />
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
              <div className="flex items-center gap-4 px-5 pb-4">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-[#34d4b1]" />
                  <span className="text-2xs text-ink-200">Income</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm bg-[#f87171]" />
                  <span className="text-2xs text-ink-200">Expenses</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#f5a623" strokeWidth="2"/></svg>
                  <span className="text-2xs text-ink-200">Net</span>
                </div>
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              No cash flow data yet
            </div>
          )}
        </Card>

        {/* Expense breakdown — prior 3 months */}
        <Card padding={false}>
          <div className="flex items-center justify-between p-5 pb-2">
            <CardHeader title="Avg Expenses — 3 Months" />
            <Link to="/reports/spending" className="text-2xs text-amber-400 hover:text-amber-300">Details →</Link>
          </div>
          {expensePieData.length > 0 ? (
            <div className="flex flex-col items-center pb-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={expensePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2}>
                    {expensePieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12, color: '#e8e6e3' }}
                    itemStyle={{ color: '#e8e6e3' }}
                    formatter={(v: number, name: string) => [formatCurrencyWhole(v), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-5">
                {expensePieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                    <span className="text-2xs text-ink-200">{d.name}</span>
                    <span className="text-2xs text-ink-300 font-mono">{formatCurrencyWhole(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              No expense data yet
            </div>
          )}
        </Card>
      </div>

    </div>
  )
}
