import { useState } from 'react'
import { useNetWorthHistory, useEquityHistory, useAccounts, useAccountTypeMap } from '@/hooks'
import { Card, Spinner, FilterDropdown, CheckboxRow } from '@/components/ui'
import { formatCurrencyWhole, formatCurrencySignedWhole } from '@/lib/format'
import type { AccountType, Account } from '@/types'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import clsx from 'clsx'
import { CHART_COLORS, niceTicks } from './shared'

const NW_OPTIONS: { months: number; label: string; changeLabel: string }[] = [
  { months: 6, label: '6M', changeLabel: '6 Month Change' },
  { months: 12, label: '1Y', changeLabel: '1 Year Change' },
  { months: 60, label: '5Y', changeLabel: '5 Year Change' },
  { months: 240, label: 'ALL', changeLabel: 'All Time Change' },
]

// A single line the user can chart in the "Accounts & Groups" view.
type SeriesRef =
  | { kind: 'account'; id: number }               // one account
  | { kind: 'group'; accountType: AccountType }    // all accounts of a type
  | { kind: 'filter'; filter: 'liquid' | 'assets' | 'liabilities' } // quick semantic set

const seriesKey = (ref: SeriesRef): string =>
  ref.kind === 'account' ? `a:${ref.id}`
    : ref.kind === 'group' ? `g:${ref.accountType}`
      : `f:${ref.filter}`

const FILTER_LABELS: Record<'liquid' | 'assets' | 'liabilities', string> = {
  liquid: 'All Liquid Assets',
  assets: 'All Assets',
  liabilities: 'All Liabilities',
}

// Net-worth contribution of a raw snapshot balance (assets positive, liabilities negative).
const signedBalance = (acc: Account | undefined, raw: number | undefined): number => {
  if (acc == null || raw == null) return 0
  return acc.is_liability ? -raw : raw
}

export default function NetWorthTab() {
  const [nwMonths, setNwMonths] = useState(12)
  const [nwMode, setNwMode] = useState<'net-worth' | 'equity' | 'series'>('net-worth')
  const [equityAssetId, setEquityAssetId] = useState<number | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<SeriesRef[]>([])
  const [seriesDisplay, setSeriesDisplay] = useState<'compare' | 'combined'>('compare')

  const { data: nwHistory, isLoading: nwLoading } = useNetWorthHistory(nwMonths + 1)
  const { data: equityHistory, isLoading: equityLoading } = useEquityHistory(nwMonths + 1)
  const { data: accounts } = useAccounts({ active_only: false })
  const accountTypes = useAccountTypeMap()

  // Net worth chart data — trim leading months with no real balance data, and trailing current (partial) month
  const nwDataRaw = nwHistory?.data_points.map(p => ({
    date: p.date.slice(0, 7),
    assets: p.total_assets,
    liabilities: p.total_liabilities,
    net: p.net_worth,
  })) ?? []
  const firstRealIdx = nwDataRaw.findIndex(p => p.assets !== 0 || p.liabilities !== 0)
  const nwDataAll = firstRealIdx >= 0 ? nwDataRaw.slice(firstRealIdx) : []
  // Drop the last entry (current in-progress month) so the rightmost point is the last complete month
  const nwData = nwDataAll.length > 1 ? nwDataAll.slice(0, -1) : nwDataAll

  // Compute synced Y-axis domains: all three axes share the same magnitude so relative changes are comparable
  const TICK_COUNT = 5
  const evenTicks = (min: number, max: number): number[] => {
    const step = (max - min) / (TICK_COUNT - 1)
    return Array.from({ length: TICK_COUNT }, (_, i) => Math.round(min + step * i))
  }
  const nwSyncedDomain = (() => {
    if (!nwData.length) return { net: ['auto', 'auto'] as ['auto', 'auto'], assets: ['auto', 'auto'] as ['auto', 'auto'], liabs: ['auto', 'auto'] as ['auto', 'auto'], netTicks: undefined as number[] | undefined, assetTicks: undefined as number[] | undefined, liabTicks: undefined as number[] | undefined }
    const rangeOf = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
    const midOf = (vals: number[]) => (Math.min(...vals) + Math.max(...vals)) / 2
    const nets = nwData.map(p => p.net)
    const assets = nwData.map(p => p.assets)
    const liabs = nwData.map(p => p.liabilities)
    const mag = Math.max(rangeOf(nets), rangeOf(assets), rangeOf(liabs)) * 1.1 || 1
    const half = mag / 2
    const netDom: [number, number] = [midOf(nets) - half, midOf(nets) + half]
    const assetDom: [number, number] = [midOf(assets) - half, midOf(assets) + half]
    const liabDom: [number, number] = [midOf(liabs) - half, midOf(liabs) + half]
    return {
      net: netDom, assets: assetDom, liabs: liabDom,
      netTicks: evenTicks(...netDom), assetTicks: evenTicks(...assetDom), liabTicks: evenTicks(...liabDom),
    }
  })()

  // Equity pair chart data — defaults to the first pair until the user picks one
  const effectiveEquityId = equityAssetId ?? equityHistory?.pairs?.[0]?.asset_id ?? null
  const selectedEquityPair = effectiveEquityId != null
    ? equityHistory?.pairs.find(p => p.asset_id === effectiveEquityId) ?? null
    : null
  const equityChartDataRaw = selectedEquityPair?.data_points.map(p => ({
    date: p.date.slice(0, 7),
    asset: p.asset_value,
    liability: p.liability_balance,
    equity: p.equity,
  })) ?? []
  const firstRealEqIdx = equityChartDataRaw.findIndex(p => p.asset !== 0 || p.liability !== 0)
  const equityChartDataAll = firstRealEqIdx >= 0 ? equityChartDataRaw.slice(firstRealEqIdx) : []
  // Drop current in-progress month
  const equityChartData = equityChartDataAll.length > 1 ? equityChartDataAll.slice(0, -1) : equityChartDataAll

  // Synced Y-axis domains for equity chart
  const eqSyncedDomain = (() => {
    if (!equityChartData.length) return { equity: ['auto', 'auto'] as ['auto', 'auto'], asset: ['auto', 'auto'] as ['auto', 'auto'], liability: ['auto', 'auto'] as ['auto', 'auto'], equityTicks: undefined as number[] | undefined, assetTicks: undefined as number[] | undefined, liabilityTicks: undefined as number[] | undefined }
    const rangeOf = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
    const midOf = (vals: number[]) => (Math.min(...vals) + Math.max(...vals)) / 2
    const equities = equityChartData.map(p => p.equity)
    const assets = equityChartData.map(p => p.asset)
    const liabs = equityChartData.map(p => p.liability)
    const mag = Math.max(rangeOf(equities), rangeOf(assets), rangeOf(liabs)) * 1.1 || 1
    const half = mag / 2
    const equityDom: [number, number] = [midOf(equities) - half, midOf(equities) + half]
    const assetDom: [number, number] = [midOf(assets) - half, midOf(assets) + half]
    const liabDom: [number, number] = [midOf(liabs) - half, midOf(liabs) + half]
    return {
      equity: equityDom, asset: assetDom, liability: liabDom,
      equityTicks: evenTicks(...equityDom), assetTicks: evenTicks(...assetDom), liabilityTicks: evenTicks(...liabDom),
    }
  })()

  // ── "Accounts & Groups" series (individual accounts, type groups, quick filters) ──
  const accountMap = new Map((accounts ?? []).map(a => [a.id, a]))
  const activeAccounts = (accounts ?? []).filter(a => a.is_active)
  // Account-type groups present among active accounts, ordered by each type's
  // configured sort_order (types hidden/absent from the map fall to the end).
  const typeOrder = (k: string) => accountTypes.byKey.get(k)?.sort_order ?? 999
  const presentTypes = Array.from(new Set(activeAccounts.map(a => a.account_type)))
    .sort((a, b) => typeOrder(a) - typeOrder(b))

  const resolveSeriesAccountIds = (ref: SeriesRef): number[] => {
    if (ref.kind === 'account') return [ref.id]
    if (ref.kind === 'group') return activeAccounts.filter(a => a.account_type === ref.accountType).map(a => a.id)
    if (ref.filter === 'liquid') return activeAccounts.filter(a => a.is_liquid && !a.is_liability).map(a => a.id)
    if (ref.filter === 'assets') return activeAccounts.filter(a => !a.is_liability).map(a => a.id)
    return activeAccounts.filter(a => a.is_liability).map(a => a.id)
  }
  const seriesLabel = (ref: SeriesRef): string => {
    if (ref.kind === 'account') return accountMap.get(ref.id)?.name ?? `Account ${ref.id}`
    if (ref.kind === 'group') return `All ${accountTypes.label(ref.accountType)}`
    return FILTER_LABELS[ref.filter]
  }
  const resolvedSeries = selectedSeries.map((ref, i) => ({
    ref,
    key: seriesKey(ref),
    label: seriesLabel(ref),
    accountIds: resolveSeriesAccountIds(ref),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
  // Selections can overlap (e.g. "All Checking" plus an individual checking account) — dedupe
  // account IDs across all selected series so the combined total never double-counts an account.
  const combinedAccountIds = new Set(resolvedSeries.flatMap(s => s.accountIds))

  // Per-month value for each series, net-worth-signed, aligned to the net worth timeline
  const seriesRowsRaw = (nwHistory?.data_points ?? []).map(p => {
    const row: Record<string, number | string> = { date: p.date.slice(0, 7) }
    for (const s of resolvedSeries) {
      let v = 0
      for (const id of s.accountIds) v += signedBalance(accountMap.get(id), p.by_account[String(id)])
      row[s.key] = Math.round(v * 100) / 100
    }
    let combined = 0
    for (const id of combinedAccountIds) combined += signedBalance(accountMap.get(id), p.by_account[String(id)])
    row.__combined = Math.round(combined * 100) / 100
    return row
  })
  const seriesRowIsEmpty = (row: Record<string, number | string>) =>
    resolvedSeries.every(s => (row[s.key] as number) === 0)
  const firstRealSeriesIdx = seriesRowsRaw.findIndex(r => !seriesRowIsEmpty(r))
  const seriesRowsTrimmed = firstRealSeriesIdx >= 0 ? seriesRowsRaw.slice(firstRealSeriesIdx) : []
  // Drop current in-progress month so the rightmost point is the last complete month
  const seriesChartData = seriesRowsTrimmed.length > 1 ? seriesRowsTrimmed.slice(0, -1) : seriesRowsTrimmed
  const seriesCombined = seriesChartData.map(r => r.__combined as number)

  // Y-axis for the series chart — scale to the plotted data instead of anchoring at 0 (so
  // smaller trends stay visible), with uniformly-spaced, round-number ticks for easy comparison.
  const seriesActiveKeys = seriesDisplay === 'combined' && resolvedSeries.length >= 2
    ? ['__combined']
    : resolvedSeries.map(s => s.key)
  const seriesYAxis: { domain: ['auto', 'auto'] | [number, number]; ticks: number[] | undefined } = (() => {
    if (!seriesChartData.length || !seriesActiveKeys.length) return { domain: ['auto', 'auto'], ticks: undefined }
    const vals = seriesChartData.flatMap(row => seriesActiveKeys.map(k => row[k] as number))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1
    const { domain, ticks } = niceTicks(min - pad, max + pad)
    return { domain, ticks }
  })()

  const isSeriesSelected = (ref: SeriesRef) => selectedSeries.some(r => seriesKey(r) === seriesKey(ref))
  const toggleSeries = (ref: SeriesRef) => setSelectedSeries(prev =>
    prev.some(r => seriesKey(r) === seriesKey(ref))
      ? prev.filter(r => seriesKey(r) !== seriesKey(ref))
      : [...prev, ref]
  )

  const hasEquityPairs = (equityHistory?.pairs?.length ?? 0) > 0
  const nwModeOptions: { value: 'net-worth' | 'equity' | 'series'; label: string }[] = [
    { value: 'net-worth', label: 'Net Worth' },
    ...(hasEquityPairs ? [{ value: 'equity' as const, label: 'Equity' }] : []),
    { value: 'series' as const, label: 'Accounts & Groups' },
  ]
  const headlineValue: number | null =
    nwMode === 'net-worth' ? (nwHistory?.current_net_worth ?? null)
      : nwMode === 'equity' ? (selectedEquityPair?.current_equity ?? null)
        : (seriesCombined.length ? seriesCombined[seriesCombined.length - 1] : null)

  return (
    <div className="space-y-4">
      {/* Header card with view selector, time filter, and change stats */}
      <Card padding={false}>
        <div className="p-5 pb-3 space-y-2 md:space-y-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Mode selector: Net Worth / Equity / Accounts & Groups */}
              <div className="flex rounded-lg bg-surface-700 border border-white/[0.08] p-0.5">
                {nwModeOptions.map(m => (
                  <button
                    key={m.value}
                    onClick={() => setNwMode(m.value)}
                    className={clsx(
                      'px-3 py-1 rounded-md text-sm font-semibold transition-colors whitespace-nowrap',
                      nwMode === m.value ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {/* Equity pair picker */}
              {nwMode === 'equity' && (
                <select
                  value={effectiveEquityId ?? ''}
                  onChange={e => setEquityAssetId(Number(e.target.value))}
                  className="bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-100 focus:outline-none focus:border-amber-400/40"
                >
                  {(equityHistory?.pairs ?? []).map(p => (
                    <option key={p.asset_id} value={p.asset_id}>{p.asset_name}</option>
                  ))}
                </select>
              )}
              {/* Accounts & groups tiered multi-select picker */}
              {nwMode === 'series' && (
                <>
                  <FilterDropdown
                    disabled={!activeAccounts.length}
                    isActive={selectedSeries.length > 0}
                    buttonLabel={
                      selectedSeries.length === 0 ? 'Select accounts or groups'
                        : selectedSeries.length === 1 ? seriesLabel(selectedSeries[0])
                          : `${selectedSeries.length} selected`
                    }
                  >
                    {(['liquid', 'assets', 'liabilities'] as const).map(f => {
                      const ref: SeriesRef = { kind: 'filter', filter: f }
                      return (
                        <CheckboxRow
                          key={f}
                          checked={isSeriesSelected(ref)}
                          label={FILTER_LABELS[f]}
                          bold
                          onToggle={() => toggleSeries(ref)}
                        />
                      )
                    })}
                    <div className="h-px bg-white/[0.06] my-1" />
                    {presentTypes.map(t => {
                      const groupRef: SeriesRef = { kind: 'group', accountType: t }
                      const groupSelected = isSeriesSelected(groupRef)
                      const typeAccounts = activeAccounts.filter(a => a.account_type === t)
                      const selectedChildCount = typeAccounts.filter(a => isSeriesSelected({ kind: 'account', id: a.id })).length

                      return (
                        <div key={t} className="py-1">
                          <CheckboxRow
                            checked={groupSelected}
                            indeterminate={!groupSelected && selectedChildCount > 0}
                            label={`All ${accountTypes.label(t)}`}
                            sublabel={selectedChildCount > 0 ? `${selectedChildCount}/${typeAccounts.length} accounts selected` : undefined}
                            bold
                            onToggle={() => toggleSeries(groupRef)}
                          />
                          <div className="pl-6">
                            {typeAccounts.map(a => {
                              const accountRef: SeriesRef = { kind: 'account', id: a.id }
                              return (
                                <CheckboxRow
                                  key={a.id}
                                  checked={isSeriesSelected(accountRef)}
                                  label={a.name}
                                  onToggle={() => toggleSeries(accountRef)}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </FilterDropdown>
                  {selectedSeries.length >= 2 && (
                    <div className="flex rounded-lg bg-surface-700 border border-white/[0.08] p-0.5">
                      {(['compare', 'combined'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setSeriesDisplay(mode)}
                          className={clsx(
                            'px-3 py-1 rounded-md text-xs font-semibold capitalize transition-colors',
                            seriesDisplay === mode ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                          )}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {/* Value shown inline on desktop only */}
              <span className={`hidden md:inline font-mono text-lg ${
                (headlineValue ?? 0) >= 0 ? 'text-teal-400' : 'text-red-400'
              }`}>
                {formatCurrencyWhole(headlineValue)}
              </span>
            </div>
            <div className="flex gap-1">
              {NW_OPTIONS.map(o => (
                <button
                  key={o.months}
                  onClick={() => setNwMonths(o.months)}
                  className={clsx(
                    'px-2.5 py-1 rounded text-xs font-mono transition-colors',
                    nwMonths === o.months ? 'bg-amber-400/10 text-amber-400' : 'text-ink-300 hover:text-ink-100'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {/* Value shown below selector on mobile only */}
          <span className={`block md:hidden font-mono text-lg ${
            (headlineValue ?? 0) >= 0 ? 'text-teal-400' : 'text-red-400'
          }`}>
            {formatCurrencyWhole(headlineValue)}
          </span>
        </div>

        {/* Change stats */}
        {(() => {
          const loading = nwMode === 'equity' ? equityLoading : nwLoading
          let change1m: number | null | undefined
          let change3m: number | null | undefined
          let changePeriod: number | null | undefined

          // Compute deltas from a numeric series anchored to the last complete month
          const changesFrom = (vals: number[]) => {
            const n = vals.length
            const lastIdx = n - 1
            const lastVal = vals[lastIdx]
            return {
              c1m: lastIdx >= 1 ? Math.round((lastVal - vals[lastIdx - 1]) * 100) / 100 : null,
              c3m: Math.round((lastVal - vals[Math.max(0, lastIdx - 3)]) * 100) / 100,
              cPeriod: Math.round((lastVal - vals[0]) * 100) / 100,
            }
          }

          if (nwMode === 'net-worth') {
            change1m = nwHistory?.change_1m
            change3m = nwHistory?.change_3m
            changePeriod = nwHistory?.change_period
          } else if (nwMode === 'equity' && selectedEquityPair && equityChartData.length >= 2) {
            const c = changesFrom(equityChartData.map(p => p.equity))
            change1m = c.c1m; change3m = c.c3m; changePeriod = c.cPeriod
          } else if (nwMode === 'series' && seriesCombined.length >= 2) {
            const c = changesFrom(seriesCombined)
            change1m = c.c1m; change3m = c.c3m; changePeriod = c.cPeriod
          }

          const stats = [
            { label: '1 Month Change', value: change1m },
            { label: '3 Month Change', value: change3m },
            { label: NW_OPTIONS.find(o => o.months === nwMonths)?.changeLabel ?? 'Period Change', value: changePeriod },
          ]

          return (
            <div className="grid grid-cols-3 gap-px bg-white/[0.04] border-t border-white/[0.06]">
              {stats.map(s => (
                <div key={s.label} className="bg-surface-800 px-5 py-3">
                  <div className="label mb-1">{s.label}</div>
                  {loading ? (
                    <div className="h-6 w-24 bg-surface-700 rounded animate-pulse" />
                  ) : (
                    <div className={clsx(
                      'font-mono text-lg',
                      s.value == null ? 'text-ink-400'
                        : s.value >= 0 ? 'text-teal-400' : 'text-rose-400'
                    )}>
                      {s.value != null ? formatCurrencySignedWhole(s.value) : '—'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })()}
      </Card>

      {/* Chart */}
      {(nwMode === 'equity' ? equityLoading : nwLoading) ? (
        <Card>
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        </Card>
      ) : nwMode === 'net-worth' && nwData.length === 0 ? (
        <Card>
          <div className="py-16 text-center text-ink-400 text-sm">
            No balance history yet — update account balances to see trends
          </div>
        </Card>
      ) : nwMode === 'equity' && equityChartData.length === 0 ? (
        <Card>
          <div className="py-16 text-center text-ink-400 text-sm">
            No equity history yet — update asset and liability balances to see trends
          </div>
        </Card>
      ) : nwMode === 'series' && selectedSeries.length === 0 ? (
        <Card>
          <div className="py-16 text-center text-ink-400 text-sm">
            Pick one or more accounts or groups above to chart their balances over time
          </div>
        </Card>
      ) : nwMode === 'series' && seriesChartData.length === 0 ? (
        <Card>
          <div className="py-16 text-center text-ink-400 text-sm">
            No balance history yet for this selection — update account balances to see trends
          </div>
        </Card>
      ) : nwMode === 'net-worth' ? (
        <Card padding={false}>
          <div className="p-5 pb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
            {[
              { label: 'Net Worth', color: 'bg-amber-400', textColor: 'text-amber-400', value: nwData[nwData.length - 1]?.net ?? 0 },
              { label: 'Assets', color: 'bg-teal-400', textColor: 'text-teal-400', value: nwData[nwData.length - 1]?.assets ?? 0 },
              { label: 'Liabilities', color: 'bg-rose-400', textColor: 'text-rose-400', value: nwData[nwData.length - 1]?.liabilities ?? 0 },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className={clsx('w-2.5 h-2.5 rounded-full', item.color)} />
                <span className="text-xs text-ink-300">{item.label}</span>
                <span className={clsx('font-mono text-sm', item.textColor)}>{formatCurrencyWhole(item.value)}</span>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={nwData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="netGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5a623" stopOpacity={0.15}/>
                    <stop offset="100%" stopColor="#f5a623" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="assetsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d4b1" stopOpacity={0.1}/>
                    <stop offset="100%" stopColor="#34d4b1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="liabGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity={0.1}/>
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="net"
                  orientation="left"
                  domain={nwSyncedDomain.net}
                  ticks={nwSyncedDomain.netTicks}
                  tick={{ fill: '#f5a623', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="assets"
                  orientation="right"
                  domain={nwSyncedDomain.assets}
                  ticks={nwSyncedDomain.assetTicks}
                  tick={{ fill: '#34d4b1', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="liabilities"
                  orientation="right"
                  domain={nwSyncedDomain.liabs}
                  ticks={nwSyncedDomain.liabTicks}
                  tick={{ fill: '#f87171', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  mirror
                />
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <Tooltip
                  contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                  labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                  formatter={(v: number, name: string) => {
                    const labels: Record<string, string> = { assets: 'Assets', liabilities: 'Liabilities', net: 'Net Worth' }
                    return [formatCurrencyWhole(v), labels[name] ?? name]
                  }}
                />
                <Area type="monotone" dataKey="assets" yAxisId="assets" stroke="#34d4b1" strokeWidth={1.5} fill="url(#assetsGrad)" dot={false} />
                <Area type="monotone" dataKey="liabilities" yAxisId="liabilities" stroke="#f87171" strokeWidth={1.5} fill="url(#liabGrad)" dot={false} />
                <Area type="monotone" dataKey="net" yAxisId="net" stroke="#f5a623" strokeWidth={2} fill="url(#netGrad2)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : nwMode === 'equity' ? (
        /* Equity pair chart */
        <Card padding={false}>
          <div className="p-5 pb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
            {[
              { label: 'Equity', color: 'bg-amber-400', textColor: 'text-amber-400', value: equityChartData[equityChartData.length - 1]?.equity ?? 0 },
              { label: 'Asset Value', color: 'bg-teal-400', textColor: 'text-teal-400', value: equityChartData[equityChartData.length - 1]?.asset ?? 0 },
              { label: 'Liability', color: 'bg-rose-400', textColor: 'text-rose-400', value: equityChartData[equityChartData.length - 1]?.liability ?? 0 },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <div className={clsx('w-2.5 h-2.5 rounded-full', item.color)} />
                <span className="text-xs text-ink-300">{item.label}</span>
                <span className={clsx('font-mono text-sm', item.textColor)}>{formatCurrencyWhole(item.value)}</span>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={equityChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5a623" stopOpacity={0.15}/>
                    <stop offset="100%" stopColor="#f5a623" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="eqAssetGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d4b1" stopOpacity={0.1}/>
                    <stop offset="100%" stopColor="#34d4b1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="eqLiabGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity={0.1}/>
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="equity"
                  orientation="left"
                  domain={eqSyncedDomain.equity}
                  ticks={eqSyncedDomain.equityTicks}
                  tick={{ fill: '#f5a623', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="asset"
                  orientation="right"
                  domain={eqSyncedDomain.asset}
                  ticks={eqSyncedDomain.assetTicks}
                  tick={{ fill: '#34d4b1', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="liability"
                  orientation="right"
                  domain={eqSyncedDomain.liability}
                  ticks={eqSyncedDomain.liabilityTicks}
                  tick={{ fill: '#f87171', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  mirror
                />
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <Tooltip
                  contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                  labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                  formatter={(v: number, name: string) => {
                    const labels: Record<string, string> = { asset: 'Asset Value', liability: 'Liability', equity: 'Equity' }
                    return [formatCurrencyWhole(v), labels[name] ?? name]
                  }}
                />
                <Area type="monotone" dataKey="asset" yAxisId="asset" stroke="#34d4b1" strokeWidth={1.5} fill="url(#eqAssetGrad)" dot={false} />
                <Area type="monotone" dataKey="liability" yAxisId="liability" stroke="#f87171" strokeWidth={1.5} fill="url(#eqLiabGrad)" dot={false} />
                <Area type="monotone" dataKey="equity" yAxisId="equity" stroke="#f5a623" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : (
        /* Accounts & Groups chart */
        <Card padding={false}>
          <div className="p-5 pb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {seriesDisplay === 'combined' && resolvedSeries.length >= 2 && (
              <div className="flex items-center gap-2 pr-4 border-r border-white/[0.08]">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[0] }} />
                <span className="text-xs text-ink-300">Combined Total</span>
                <span className="font-mono text-sm text-amber-400">{formatCurrencyWhole(seriesCombined[seriesCombined.length - 1] ?? 0)}</span>
              </div>
            )}
            {resolvedSeries.map(s => (
              <div key={s.key} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-xs text-ink-300">{s.label}</span>
                <span className="font-mono text-sm" style={{ color: s.color }}>
                  {formatCurrencyWhole((seriesChartData[seriesChartData.length - 1]?.[s.key] as number) ?? 0)}
                </span>
                <button
                  onClick={() => toggleSeries(s.ref)}
                  className="text-ink-400 hover:text-rose-400 px-0.5 leading-none transition-colors"
                  aria-label={`Remove ${s.label}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={seriesChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }} tickLine={false} axisLine={false} />
                <YAxis
                  domain={seriesYAxis.domain}
                  ticks={seriesYAxis.ticks}
                  tick={{ fill: '#8a8580', fontSize: 10, fontFamily: 'DM Mono' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  width={52}
                />
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" />
                <Tooltip
                  contentStyle={{ background: '#161b24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontFamily: 'DM Mono', fontSize: 12 }}
                  labelStyle={{ color: '#8a8580', marginBottom: 4 }}
                  formatter={(v: number, name: string) => {
                    const label = name === '__combined' ? 'Combined Total' : (resolvedSeries.find(s => s.key === name)?.label ?? name)
                    return [formatCurrencyWhole(v), label]
                  }}
                />
                {seriesDisplay === 'combined' && resolvedSeries.length >= 2 ? (
                  <Area type="monotone" dataKey="__combined" stroke={CHART_COLORS[0]} strokeWidth={2} fill={CHART_COLORS[0]} fillOpacity={0.08} dot={false} />
                ) : (
                  resolvedSeries.map(s => (
                    <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.06} dot={false} />
                  ))
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  )
}
