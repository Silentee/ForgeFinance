import { Fragment, useState } from 'react'
import { useBudgetReport, useSpendingAverages } from '@/hooks'
import { useFloatingTableHeader } from '@/hooks/useFloatingTableHeader'
import { Card, Spinner } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencySignedWhole, currentYearMonth } from '@/lib/format'
import type { SpendingAverageLine } from '@/types'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'
import { CHART_COLORS } from './shared'

// Budget progress bar with a marker showing where the budget line falls relative to spending.
// Under budget: fill shows how far spent, marker pinned to the far right (budget = 100%).
// Over budget: fill is full (red), marker slides left as the overage grows (budget / actual).
function BudgetProgress({ pct }: { pct: number }) {
  const fillPct = Math.min(100, pct)
  const markerPct = pct <= 100 ? 100 : 10000 / pct
  return (
    <div className="relative flex-1">
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={clsx('h-full rounded-full', pct > 120 ? 'bg-red-400' : pct > 102 ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {/* budget-target marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-ink-100/90 rounded-full pointer-events-none"
        style={{ left: `${markerPct}%` }}
      />
    </div>
  )
}

export default function SpendingTab() {
  const now = currentYearMonth()
  const prevMonth = (() => {
    const d = new Date(now.year, now.month - 1, 1)
    d.setMonth(d.getMonth() - 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })()
  const [spendingMonth, setSpendingMonth] = useState(prevMonth.month)
  const [spendingYear, setSpendingYear] = useState(prevMonth.year)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | 'all'>('all')
  const isGroupCollapsed = (name: string) => collapsedGroups === 'all' || collapsedGroups.has(name)
  const [showDiff, setShowDiff] = useState(false)
  const [showAllCategories, setShowAllCategories] = useState(false)

  // Note when the current (incomplete) month is selected — used for the on-screen note below.
  const isCurrentMonth = spendingYear === now.year && spendingMonth === now.month
  // Per-category trailing averages — same source of truth the Budget page uses,
  // so both pages show identical 3m/6m/12m values. Pass the raw selected month;
  // the backend applies the current-month → previous-complete-month adjustment.
  const { data: spendingAverages, isLoading: spendingAveragesLoading } = useSpendingAverages(spendingYear, spendingMonth)
  const { data: budgetReport, isLoading: budgetLoading } = useBudgetReport(spendingYear, spendingMonth)

  const {
    theadRef, tableWrapperRef, floatingHeaderRef, showFloatingHeader, colCollapse, onTableScroll,
  } = useFloatingTableHeader([spendingAveragesLoading, budgetLoading])

  // Frozen category column geometry, interpolated by scroll-collapse progress (0..1).
  // Base left padding 16→8, subcategory indent 40→8, first column 180→148px.
  const catColWidth = Math.round(180 - 40 * colCollapse)
  const catBasePad = Math.round(16 - 8 * colCollapse) // both left and right edge padding: 16→8
  const catChildPadLeft = Math.round(40 - 32 * colCollapse)
  const catTableMinWidth = Math.round(690 - 40 * colCollapse)
  // Parent-row expand/collapse arrow: its fixed width + margin (20px) is the "indent"
  // that slides the name right; collapse it to 0 alongside the subcategory indent.
  const catArrowWidth = Math.round(16 * (1 - colCollapse))
  const catArrowMargin = Math.round(4 * (1 - colCollapse))

  // Per-category trailing averages, keyed by category_id.
  const avgByCatId = new Map<number, SpendingAverageLine>()
  for (const line of spendingAverages?.expense_lines ?? [])
    if (line.category_id != null) avgByCatId.set(line.category_id, line)

  // Merge budget lines with trend averages, grouped by parent
  const spendingRows = (() => {
    if (!budgetReport) return []
    const groups = new Map<string, { actual: number; budgeted: number; avg3: number; avg6: number; avg12: number; children: { name: string; actual: number; budgeted: number; pctUsed: number | null; avg3: number; avg6: number; avg12: number }[] }>()
    for (const line of budgetReport.expense_lines) {
      const parent = line.parent_category_name ?? 'Other'
      if (!groups.has(parent)) groups.set(parent, { actual: 0, budgeted: 0, avg3: 0, avg6: 0, avg12: 0, children: [] })
      const g = groups.get(parent)!
      const avgLine = line.category_id != null ? avgByCatId.get(line.category_id) : undefined
      const avgs = { avg3: avgLine?.avg_3m ?? 0, avg6: avgLine?.avg_6m ?? 0, avg12: avgLine?.avg_12m ?? 0 }
      g.actual += line.actual
      g.budgeted += line.budgeted
      g.avg3 += avgs.avg3
      g.avg6 += avgs.avg6
      g.avg12 += avgs.avg12
      g.children.push({
        name: line.category_name,
        actual: line.actual,
        budgeted: line.budgeted,
        pctUsed: line.percent_used ?? null,
        avg3: avgs.avg3,
        avg6: avgs.avg6,
        avg12: avgs.avg12,
      })
    }
    return Array.from(groups.entries())
      .map(([parent, g]) => ({
        parent,
        ...g,
        children: [...g.children].sort((a, b) => b.actual - a.actual),
        pctUsed: g.budgeted > 0 ? (g.actual / g.budgeted) * 100 : null,
      }))
      .sort((a, b) => b.actual - a.actual)
  })()

  // Pie chart data — shows parent group totals when collapsed, individual categories when expanded
  const pieData = (() => {
    if (!spendingRows.length) return []
    const items: { name: string; value: number }[] = []
    for (const group of spendingRows) {
      if (isGroupCollapsed(group.parent)) {
        if (group.actual > 0) items.push({ name: group.parent, value: group.actual })
      } else {
        for (const child of group.children) {
          if (child.actual > 0) items.push({ name: child.name, value: child.actual })
        }
      }
    }
    return items
      .sort((a, b) => b.value - a.value)
      .map((item, i) => ({ ...item, color: CHART_COLORS[i % CHART_COLORS.length] }))
  })()

  const pieColorMap = new Map(pieData.map(d => [d.name, d.color]))

  return (
    <div className="space-y-4">
      {/* Header with month/year selector */}
      <Card padding={false}>
        <div className="flex items-center justify-between p-5">
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setCollapsedGroups(new Set())}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200 transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={() => setCollapsedGroups('all')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200 transition-colors"
            >
              Collapse All
            </button>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => setShowAllCategories(v => !v)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                showAllCategories
                  ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                  : 'bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200'
              )}
            >
              All
            </button>
            <button
              onClick={() => setShowDiff(d => !d)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                showDiff
                  ? 'bg-amber-400/15 border-amber-400/40 text-amber-300'
                  : 'bg-surface-700 border-white/[0.08] text-ink-300 hover:text-ink-200'
              )}
            >
              +/-
            </button>
            <select
              value={`${spendingYear}-${spendingMonth}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number)
                setSpendingYear(y)
                setSpendingMonth(m)
              }}
              className="bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-ink-100 focus:outline-none"
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
        </div>
      </Card>

      {(spendingAveragesLoading || budgetLoading) ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <>
          {isCurrentMonth && (
            <div className="text-sm text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span className="text-amber-400 text-base">⚠</span>
              Averages are based on previous months — current month is still in progress
            </div>
          )}
          <Card padding={false}>
            <div className="flex flex-col md:flex-row">
              {/* Pie chart */}
              {pieData.length > 0 && (
                <div className="p-5 border-b md:border-b-0 md:border-r border-white/[0.06] flex-shrink-0 flex justify-center md:block">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2}>
                        {pieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12, color: '#e8e6e3' }}
                        itemStyle={{ color: '#e8e6e3' }}
                        formatter={(v: number, name: string) => [formatCurrencyWhole(v), name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Floating table header — appears when real header scrolls behind PageHeader */}
              {showFloatingHeader && (() => {
                const rect = tableWrapperRef.current?.getBoundingClientRect()
                return (
                  <div
                    className="fixed z-20 bg-surface-800 border-b border-white/[0.06] shadow-lg"
                    style={{
                      top: 'var(--page-header-height, 0px)',
                      left: rect?.left ?? 0,
                      width: rect?.width ?? '100%',
                    }}
                  >
                    <div
                      ref={floatingHeaderRef}
                      className="overflow-hidden"
                    >
                      <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth }}>
                        <colgroup>
                          <col style={{ width: catColWidth }} />
                          <col style={{ width: '100px' }} />
                          <col style={{ width: '140px' }} />
                          <col style={{ width: '90px' }} />
                          <col style={{ width: '90px' }} />
                          <col style={{ width: '90px' }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="text-left text-ink-300 text-xs font-medium py-3 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                            <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">This Month</th>
                            <th className="text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs Budget' : 'Budget'}</th>
                            <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 3M' : '3M Avg'}</th>
                            <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 6M' : '6M Avg'}</th>
                            <th className="text-right text-ink-300 text-xs font-medium px-4 py-3 bg-surface-800">{showDiff ? 'vs 12M' : '12M Avg'}</th>
                          </tr>
                        </thead>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {/* Category table */}
              <div className="flex-1 overflow-x-auto" ref={tableWrapperRef} onScroll={onTableScroll}>
                <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: catTableMinWidth }}>
                  <colgroup>
                    <col style={{ width: catColWidth }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                  </colgroup>
                  <thead ref={theadRef}>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-ink-300 text-xs font-medium py-3 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Category</th>
                      <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">This Month</th>
                      <th className="text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs Budget' : 'Budget'}</th>
                      <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 3M' : '3M Avg'}</th>
                      <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 6M' : '6M Avg'}</th>
                      <th className="text-right text-ink-300 text-xs font-medium px-4 py-3">{showDiff ? 'vs 12M' : '12M Avg'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Totals row */}
                    {budgetReport && (() => {
                      const totalPct = budgetReport.total_expenses_budgeted > 0
                        ? (budgetReport.total_expenses_actual / budgetReport.total_expenses_budgeted) * 100
                        : null
                      return (
                        <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                          <td className="py-3 font-medium text-ink-100 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>Total Expenses</td>
                          <td className="px-4 py-3 text-right font-mono text-ink-100">{formatCurrencyWhole(budgetReport.total_expenses_actual)}</td>
                          <td className="px-4 py-3">
                            {budgetReport.total_expenses_budgeted > 0 ? (
                              <div className="flex items-center gap-2">
                                <BudgetProgress pct={totalPct ?? 0} />
                                {showDiff ? (() => {
                                  const diff = budgetReport.total_expenses_actual - budgetReport.total_expenses_budgeted
                                  return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                })() : (
                                  <span className="font-mono text-ink-200 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(budgetReport.total_expenses_budgeted)}</span>
                                )}
                              </div>
                            ) : <span className="text-ink-500">—</span>}
                          </td>
                          {(() => {
                            // Total-row averages come from the same spending-averages source
                            // as the per-category rows, so the total always equals the sum of rows.
                            const totalAvg3 = spendingAverages?.total_expense_avg_3m ?? 0
                            const totalAvg6 = spendingAverages?.total_expense_avg_6m ?? 0
                            const totalAvg12 = spendingAverages?.total_expense_avg_12m ?? 0
                            const actual = budgetReport.total_expenses_actual
                            const fmtCell = (avg: number) => {
                              if (!showDiff) return formatCurrencyWhole(avg)
                              if (avg <= 0) return '—'
                              return formatCurrencySignedWhole(actual - avg)
                            }
                            const diffClass = (avg: number) => {
                              if (!showDiff || avg <= 0) return 'text-ink-200'
                              return actual - avg > 0 ? 'text-red-400' : 'text-emerald-400'
                            }
                            return [
                              ['avg3', totalAvg3],
                              ['avg6', totalAvg6],
                              ['avg12', totalAvg12],
                            ].map(([key, avg]) => (
                              <td key={key as string} className={clsx('px-4 py-3 text-right font-mono text-xs', diffClass(avg as number))}>{fmtCell(avg as number)}</td>
                            ))
                          })()}
                        </tr>
                      )
                    })()}

                    {spendingRows.filter(group => showAllCategories || Math.abs(group.actual) > 0.000001 || group.children.some(child => Math.abs(child.actual) > 0.000001)).map(group => {
                      const groupExpanded = !isGroupCollapsed(group.parent)
                      const visibleChildren = group.children.filter(child => showAllCategories || Math.abs(child.actual) > 0.000001)
                      return (
                      <Fragment key={`group-${group.parent}`}>
                        {/* Parent group header */}
                        <tr
                          className="group bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] transition-colors border-t border-white/[0.12]"
                          onClick={() => setCollapsedGroups(prev => {
                            if (prev === 'all') {
                              // Expand just this group: create set of all groups except this one
                              const allNames = spendingRows.map(g => g.parent)
                              const next = new Set(allNames)
                              next.delete(group.parent)
                              return next
                            }
                            const next = new Set(prev)
                            if (next.has(group.parent)) next.delete(group.parent)
                            else next.add(group.parent)
                            return next
                          })}
                        >
                          <td className="py-2.5 font-medium text-ink-100 sticky left-0 z-10 bg-surface-800 group-hover:bg-surface-700 transition-colors" style={{ paddingLeft: catBasePad, paddingRight: catBasePad }}>
                            <span className="inline-block overflow-hidden text-ink-400 text-xs" style={{ width: catArrowWidth, marginRight: catArrowMargin }}>
                              {isGroupCollapsed(group.parent) ? '▸' : '▾'}
                            </span>
                            {pieColorMap.has(group.parent) && (
                              <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: pieColorMap.get(group.parent) }} />
                            )}
                            {group.parent}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-ink-100">{groupExpanded ? null : formatCurrencyWhole(group.actual)}</td>
                          <td className="px-4 py-2.5">
                            {groupExpanded ? null : (group.budgeted > 0 ? (
                              <div className="flex items-center gap-2">
                                <BudgetProgress pct={group.pctUsed ?? 0} />
                                {showDiff ? (() => {
                                  const diff = group.actual - group.budgeted
                                  return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                })() : (
                                  <span className="font-mono text-ink-200 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(group.budgeted)}</span>
                                )}
                              </div>
                            ) : <span className="text-ink-500">—</span>)}
                          </td>
                          <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg3 > 0 ? (showDiff ? (group.actual - group.avg3 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg3 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                            {groupExpanded ? null : (group.avg3 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg3) : formatCurrencyWhole(group.avg3)) : '—')}
                          </td>
                          <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg6 > 0 ? (showDiff ? (group.actual - group.avg6 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg6 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                            {groupExpanded ? null : (group.avg6 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg6) : formatCurrencyWhole(group.avg6)) : '—')}
                          </td>
                          <td className={clsx('px-4 py-2.5 text-right font-mono text-xs', groupExpanded ? '' : (group.avg12 > 0 ? (showDiff ? (group.actual - group.avg12 > 0 ? 'text-red-400' : 'text-emerald-400') : (group.actual > group.avg12 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400'))}>
                            {groupExpanded ? null : (group.avg12 > 0 ? (showDiff ? formatCurrencySignedWhole(group.actual - group.avg12) : formatCurrencyWhole(group.avg12)) : '—')}
                          </td>
                        </tr>

                        {/* Child category rows */}
                        {groupExpanded && visibleChildren.map((child) => (
                          <tr key={`child-${child.name}`} className="border-t border-white/[0.03]">
                            <td className="py-2 text-ink-300 sticky left-0 z-10 bg-surface-800" style={{ paddingLeft: catChildPadLeft, paddingRight: catBasePad }}>
                              {pieColorMap.has(child.name) && (
                                <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: pieColorMap.get(child.name) }} />
                              )}
                              {child.name}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-ink-200">{formatCurrencyWhole(child.actual)}</td>
                            <td className="px-4 py-2">
                              {child.budgeted > 0 ? (
                                <div className="flex items-center gap-2">
                                  <BudgetProgress pct={child.pctUsed ?? 0} />
                                  {showDiff ? (() => {
                                    const diff = child.actual - child.budgeted
                                    return <span className={clsx('font-mono text-xs w-16 text-right flex-shrink-0', diff > 0 ? 'text-red-400' : 'text-emerald-400')}>{formatCurrencySignedWhole(diff)}</span>
                                  })() : (
                                    <span className="font-mono text-ink-300 text-xs w-16 text-right flex-shrink-0">{formatCurrencyWhole(child.budgeted)}</span>
                                  )}
                                </div>
                              ) : <span className="text-ink-500">—</span>}
                            </td>
                            <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg3 > 0 ? (showDiff ? (child.actual - child.avg3 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg3 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                              {child.avg3 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg3) : formatCurrencyWhole(child.avg3)) : '—'}
                            </td>
                            <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg6 > 0 ? (showDiff ? (child.actual - child.avg6 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg6 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                              {child.avg6 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg6) : formatCurrencyWhole(child.avg6)) : '—'}
                            </td>
                            <td className={clsx('px-4 py-2 text-right font-mono text-xs', child.avg12 > 0 ? (showDiff ? (child.actual - child.avg12 > 0 ? 'text-red-400' : 'text-emerald-400') : (child.actual > child.avg12 ? 'text-red-400' : 'text-emerald-400')) : 'text-ink-400')}>
                              {child.avg12 > 0 ? (showDiff ? formatCurrencySignedWhole(child.actual - child.avg12) : formatCurrencyWhole(child.avg12)) : '—'}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
