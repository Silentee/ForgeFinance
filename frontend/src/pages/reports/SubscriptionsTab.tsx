import { useMemo, useState } from 'react'
import {
  useCategories,
  useSubscriptionsReport,
  useUpsertSubscriptionRule,
  useDeleteSubscriptionRule,
  useSetSubscriptionNickname,
  useLinkSubscriptions,
  useUnlinkSubscription,
} from '@/hooks'
import { Button, Card, CheckboxRow, FilterDropdown, Modal, Spinner } from '@/components/ui'
import {
  formatCurrency,
  formatCurrencyWhole,
  formatDateShort,
  sortBySortOrder,
} from '@/lib/format'
import type { SubscriptionCadence, SubscriptionItem, SubscriptionsReport } from '@/types'
import clsx from 'clsx'

const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Every 6 months',
  annual: 'Yearly',
  irregular: 'Irregular',
}

const CANDIDATE_REASONS: Record<string, string> = {
  irregular_cadence: 'charges arrive at irregular intervals',
  amount_varies: 'amounts vary too much between charges',
  too_few_occurrences: 'not enough charges yet to confirm a pattern',
}

// Category groups hidden by default: recurring bills (rent, electricity, …)
// are technically subscriptions but usually noise on this report.
const DEFAULT_HIDDEN_GROUPS = new Set(['essential', 'utilities'])

interface CategoryFilter {
  categoryIds: number[]
  includeUncategorized: boolean
}

// The user-chosen nickname wins over the derived merchant name everywhere.
const displayName = (x: { nickname?: string; display_name: string }) =>
  x.nickname || x.display_name

function StatusBadge({ status }: { status: SubscriptionItem['status'] }) {
  return (
    <span
      className={clsx(
        'inline-block rounded-full px-2 py-0.5 text-2xs font-medium',
        status === 'active'
          ? 'bg-teal-400/10 text-teal-400'
          : 'bg-amber-400/10 text-amber-400'
      )}
    >
      {status === 'active' ? 'Active' : 'Lapsed'}
    </span>
  )
}

function SubscriptionRows({
  items,
  action,
  onEdit,
}: {
  items: SubscriptionItem[]
  action: (item: SubscriptionItem) => { label: string; onClick: () => void; disabled: boolean }
  onEdit?: (item: SubscriptionItem) => void
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-2xs uppercase tracking-wider text-ink-400 border-b border-white/[0.06]">
          <th className="py-2 pr-3 font-medium">Merchant</th>
          <th className="py-2 pr-3 font-medium text-right">Amount</th>
          <th className="py-2 pr-3 font-medium">Cadence</th>
          <th className="py-2 pr-3 font-medium">Last charged</th>
          <th className="py-2 pr-3 font-medium">Next expected</th>
          <th className="py-2 pr-3 font-medium text-right">Monthly eq.</th>
          <th className="py-2 pr-3 font-medium">Status</th>
          <th className="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const act = action(item)
          return (
            <tr key={item.merchant_key} className="border-b border-white/[0.04] last:border-0">
              <td className="py-2.5 pr-3">
                <div
                  className="text-ink-100 truncate max-w-[220px]"
                  title={
                    item.nickname
                      ? `${item.nickname} — detected as "${item.display_name}"`
                      : item.display_name
                  }
                >
                  {displayName(item)}
                  {item.is_manual && (
                    <span className="ml-2 rounded-full bg-sky-400/10 px-2 py-0.5 text-2xs text-sky-400">
                      manual
                    </span>
                  )}
                  {item.is_tagged && (
                    <span className="ml-2 rounded-full bg-violet-400/10 px-2 py-0.5 text-2xs text-violet-400">
                      tagged
                    </span>
                  )}
                  {item.linked_keys.length > 0 && (
                    <span
                      className="ml-2 rounded-full bg-cyan-400/10 px-2 py-0.5 text-2xs text-cyan-400"
                      title={`Includes ${item.linked_keys.join(', ')}`}
                    >
                      linked ×{item.linked_keys.length + 1}
                    </span>
                  )}
                </div>
                {item.category_name && (
                  <div className="text-2xs text-ink-400">{item.category_name}</div>
                )}
              </td>
              <td className="py-2.5 pr-3 text-right">
                <span className="font-mono text-ink-100">{formatCurrency(item.amount)}</span>
                {item.price_increased && item.previous_amount != null && (
                  <div className="text-2xs text-rose-400">
                    ↑ from {formatCurrency(item.previous_amount)}
                    {item.price_change_pct != null && ` (+${item.price_change_pct}%)`}
                  </div>
                )}
              </td>
              <td className="py-2.5 pr-3 text-ink-200">{CADENCE_LABELS[item.cadence]}</td>
              <td className="py-2.5 pr-3 text-ink-200">{formatDateShort(item.last_charged)}</td>
              <td className="py-2.5 pr-3 text-ink-200">
                {item.next_expected ? formatDateShort(item.next_expected) : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-ink-100">
                {formatCurrency(item.monthly_equivalent)}
              </td>
              <td className="py-2.5 pr-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">
                {onEdit && (
                  <button
                    onClick={() => onEdit(item)}
                    className="mr-3 text-xs text-ink-400 hover:text-ink-100"
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={act.onClick}
                  disabled={act.disabled}
                  className="text-xs text-ink-400 hover:text-ink-100 disabled:opacity-50"
                >
                  {act.label}
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function EditSubscriptionDialog({
  item,
  report,
  onClose,
}: {
  item: SubscriptionItem
  report: SubscriptionsReport
  onClose: () => void
}) {
  const setNickname = useSetSubscriptionNickname()
  const linkSubs = useLinkSubscriptions()
  const unlinkSub = useUnlinkSubscription()

  const [nickname, setNicknameText] = useState(item.nickname ?? '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const busy = setNickname.isPending || linkSubs.isPending || unlinkSub.isPending

  // Other report rows that can be merged into this subscription. Rows
  // already linked somewhere don't appear in the report, so this list is
  // automatically limited to unlinked merchants.
  const options = useMemo(
    () => [
      ...report.subscriptions
        .filter(s => s.merchant_key !== item.merchant_key)
        .map(s => ({
          key: s.merchant_key,
          label: displayName(s),
          sublabel: `${formatCurrency(s.amount)} · ${CADENCE_LABELS[s.cadence]}`,
        })),
      ...report.candidates
        .filter(c => c.merchant_key !== item.merchant_key)
        .map(c => ({
          key: c.merchant_key,
          label: displayName(c),
          sublabel: `${formatCurrency(c.median_amount)} median · ${c.occurrence_count} charges`,
        })),
    ],
    [report, item.merchant_key]
  )

  const query = search.trim().toLowerCase()
  const visibleOptions = query
    ? options.filter(o => o.label.toLowerCase().includes(query) || o.key.includes(query))
    : options

  const nicknameDirty = nickname.trim() !== (item.nickname ?? '')
  const saveNickname = () => {
    if (!nicknameDirty) return
    setNickname.mutate({
      merchant_key: item.merchant_key,
      nickname: nickname.trim() || undefined,
    })
  }

  const linkSelected = () =>
    linkSubs.mutate(
      { target_key: item.merchant_key, merchant_keys: Array.from(selected) },
      { onSuccess: () => setSelected(new Set()) }
    )

  const toggleSelected = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-medium text-ink-100 mb-1">Edit subscription</h3>
      <p className="text-xs text-ink-400 mb-4 truncate" title={item.display_name}>
        detected as “{item.display_name}”
      </p>

      <div className="space-y-5">
        <div>
          <label className="label block mb-1.5">Nickname</label>
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={e => setNicknameText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveNickname()}
              placeholder={item.display_name}
              className="min-w-0 flex-1 bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
            />
            <Button
              size="sm"
              onClick={saveNickname}
              loading={setNickname.isPending}
              disabled={busy || !nicknameDirty}
            >
              Save
            </Button>
          </div>
          <p className="text-2xs text-ink-400 mt-1">
            Shown in place of the detected name. Leave empty to clear.
          </p>
        </div>

        {item.linked_keys.length > 0 && (
          <div>
            <label className="label block mb-1.5">Linked merchants</label>
            <div className="space-y-1">
              {item.linked_keys.map(key => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded border border-white/[0.06] px-3 py-1.5"
                >
                  <span className="text-sm text-ink-200 truncate" title={key}>
                    {key}
                  </span>
                  <button
                    onClick={() => unlinkSub.mutate({ merchant_key: key })}
                    disabled={busy}
                    className="shrink-0 text-xs text-ink-400 hover:text-rose-400 disabled:opacity-50"
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label block mb-1.5">Link another charge</label>
          <p className="text-2xs text-ink-400 mb-2">
            Link rows that are really this same subscription under a different name —
            their charges then count as one recurring series.
          </p>
          {options.length === 0 ? (
            <p className="text-xs text-ink-400">No other rows available to link.</p>
          ) : (
            <>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search merchants…"
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 mb-1"
              />
              <div className="max-h-48 overflow-y-auto">
                {visibleOptions.map(o => (
                  <CheckboxRow
                    key={o.key}
                    checked={selected.has(o.key)}
                    label={o.label}
                    sublabel={o.sublabel}
                    disabled={busy}
                    onToggle={() => toggleSelected(o.key)}
                  />
                ))}
                {visibleOptions.length === 0 && (
                  <p className="text-xs text-ink-400 px-2 py-2">No matches.</p>
                )}
              </div>
              <div className="flex justify-end mt-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={linkSelected}
                  loading={linkSubs.isPending}
                  disabled={busy || selected.size === 0}
                >
                  Link {selected.size || ''} selected
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function SubscriptionsTab() {
  const [months, setMonths] = useState(24)
  const [taggedOnly, setTaggedOnly] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  // Keyed by merchant_key (not the item object) so the open dialog reflects
  // the freshly refetched report after each nickname/link mutation.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // null = user hasn't touched the filter; the computed default applies.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter | null>(null)

  const { data: report, isLoading } = useSubscriptionsReport({ months, tagged_only: taggedOnly })
  const { data: categories } = useCategories({ expense_only: true })
  const upsertRule = useUpsertSubscriptionRule()
  const deleteRule = useDeleteSubscriptionRule()

  const parents = useMemo(
    () => sortBySortOrder((categories ?? []).filter(c => c.children.length > 0)),
    [categories]
  )
  const allChildIds = useMemo(() => parents.flatMap(p => p.children.map(c => c.id)), [parents])
  const knownChildIds = useMemo(() => new Set(allChildIds), [allChildIds])
  const childNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of parents) for (const c of p.children) m.set(c.id, c.name)
    return m
  }, [parents])

  const defaultFilter = useMemo<CategoryFilter | null>(() => {
    if (!categories) return null
    return {
      categoryIds: parents
        .filter(p => !DEFAULT_HIDDEN_GROUPS.has(p.name.toLowerCase()))
        .flatMap(p => p.children.map(c => c.id)),
      includeUncategorized: true,
    }
  }, [categories, parents])

  // null until categories load, which disables filtering entirely.
  const effectiveFilter = categoryFilter ?? defaultFilter
  const selectedSet = useMemo(
    () => (effectiveFilter ? new Set(effectiveFilter.categoryIds) : null),
    [effectiveFilter]
  )

  if (isLoading || !report) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="lg" />
      </div>
    )
  }

  const busy = upsertRule.isPending || deleteRule.isPending

  const updateFilter = (next: (base: CategoryFilter) => CategoryFilter) => {
    setCategoryFilter(prev => {
      const base = prev ?? defaultFilter
      return base ? next(base) : prev
    })
  }
  const toggleGroup = (childIds: number[]) =>
    updateFilter(base => {
      const ids = new Set(base.categoryIds)
      const isAll = childIds.every(id => ids.has(id))
      for (const id of childIds) {
        if (isAll) ids.delete(id)
        else ids.add(id)
      }
      return { ...base, categoryIds: Array.from(ids.values()).sort((a, b) => a - b) }
    })
  const toggleChild = (id: number) =>
    updateFilter(base => {
      const ids = new Set(base.categoryIds)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { ...base, categoryIds: Array.from(ids.values()).sort((a, b) => a - b) }
    })

  const allSelected =
    effectiveFilter != null &&
    effectiveFilter.includeUncategorized &&
    allChildIds.every(id => selectedSet!.has(id))

  const filterLabel = (() => {
    if (!effectiveFilter || allSelected) return 'All categories'
    const count = effectiveFilter.categoryIds.length + (effectiveFilter.includeUncategorized ? 1 : 0)
    if (count === 0) return 'None selected'
    if (count === 1 && effectiveFilter.includeUncategorized) return 'Uncategorized'
    if (count === 1) return childNameById.get(effectiveFilter.categoryIds[0]) ?? '1 selected'
    return `${count} selected`
  })()

  // Unknown ids (hidden categories, childless parents like the seeded
  // "Uncategorized") bucket under the Uncategorized row so nothing vanishes.
  const matchesFilter = (categoryId?: number) => {
    if (!effectiveFilter || !selectedSet) return true
    if (categoryId != null && knownChildIds.has(categoryId)) return selectedSet.has(categoryId)
    return effectiveFilter.includeUncategorized
  }

  const filteredSubs = report.subscriptions.filter(s => matchesFilter(s.category_id))
  const filteredDismissed = report.dismissed.filter(s => matchesFilter(s.category_id))
  const filteredCandidates = report.candidates.filter(c => matchesFilter(c.category_id))

  const editingItem = editingKey
    ? ([...report.subscriptions, ...report.dismissed].find(s => s.merchant_key === editingKey) ??
      null)
    : null

  // Summary values reflect the category filter, so they're recomputed here
  // rather than taken from the server totals.
  const activeSubs = filteredSubs.filter(s => s.status === 'active')
  const totalMonthly = activeSubs.reduce((sum, s) => sum + s.monthly_equivalent, 0)
  const totalAnnual = activeSubs.reduce((sum, s) => sum + s.annual_equivalent, 0)
  const lapsedCount = filteredSubs.length - activeSubs.length
  const priceIncreaseCount = filteredSubs.filter(s => s.price_increased).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
        <span className="text-ink-500">Category:</span>
        <FilterDropdown
          disabled={!categories?.length}
          isActive={effectiveFilter != null && !allSelected}
          buttonLabel={filterLabel}
        >
          <CheckboxRow
            checked={allSelected}
            indeterminate={
              effectiveFilter != null &&
              !allSelected &&
              (effectiveFilter.categoryIds.length > 0 || effectiveFilter.includeUncategorized)
            }
            label="All categories"
            bold
            onToggle={() =>
              updateFilter(base => {
                const isAll =
                  base.includeUncategorized && allChildIds.every(id => base.categoryIds.includes(id))
                return isAll
                  ? { categoryIds: [], includeUncategorized: false }
                  : { categoryIds: [...allChildIds], includeUncategorized: true }
              })
            }
          />
          <div className="h-px bg-white/[0.06] my-1" />
          <CheckboxRow
            checked={effectiveFilter?.includeUncategorized ?? true}
            label="Uncategorized"
            onToggle={() =>
              updateFilter(base => ({ ...base, includeUncategorized: !base.includeUncategorized }))
            }
          />
          <div className="h-px bg-white/[0.06] my-1" />
          {parents.map(parent => {
            const children = sortBySortOrder(parent.children)
            const childIds = children.map(c => c.id)
            const selectedCount = childIds.filter(id => selectedSet?.has(id)).length
            return (
              <div key={parent.id} className="py-1">
                <CheckboxRow
                  checked={selectedCount === childIds.length}
                  indeterminate={selectedCount > 0 && selectedCount < childIds.length}
                  label={parent.name}
                  sublabel={`${selectedCount}/${childIds.length} selected`}
                  bold
                  onToggle={() => toggleGroup(childIds)}
                />
                <div className="pl-6">
                  {children.map(child => (
                    <CheckboxRow
                      key={child.id}
                      checked={selectedSet?.has(child.id) ?? false}
                      label={child.name}
                      onToggle={() => toggleChild(child.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </FilterDropdown>
        <button
          type="button"
          onClick={() => setTaggedOnly(v => !v)}
          title='Only show transactions categorized as "Subscriptions"'
          className={clsx(
            'bg-surface-700 rounded-lg px-3 py-2 text-sm transition-colors border',
            taggedOnly
              ? 'border-amber-400/40 bg-amber-400/5 text-amber-300'
              : 'border-white/[0.08] text-ink-100'
          )}
        >
          Tagged only
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span>Lookback:</span>
          <select
            value={months}
            onChange={e => setMonths(Number(e.target.value))}
            className="bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-ink-100 focus:outline-none focus:border-amber-400/40"
          >
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
            <option value={36}>36 months</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding={false} className="p-4">
          <div className="label text-ink-200">Monthly Recurring</div>
          <div className="font-mono text-xl mt-2 text-teal-400">
            {formatCurrency(totalMonthly)}
          </div>
          <div className="text-xs text-ink-300 mt-1">across active subscriptions</div>
        </Card>
        <Card padding={false} className="p-4">
          <div className="label text-ink-200">Annual Recurring</div>
          <div className="font-mono text-xl mt-2 text-ink-100">
            {formatCurrencyWhole(totalAnnual)}
          </div>
          <div className="text-xs text-ink-300 mt-1">what a year of subscriptions costs</div>
        </Card>
        <Card padding={false} className="p-4">
          <div className="label text-ink-200">Active Subscriptions</div>
          <div className="font-mono text-xl mt-2 text-ink-100">{activeSubs.length}</div>
          <div className="text-xs mt-1 space-x-3">
            {lapsedCount > 0 && (
              <span className="text-amber-400">{lapsedCount} lapsed</span>
            )}
            {priceIncreaseCount > 0 && (
              <span className="text-rose-400">{priceIncreaseCount} price increase{priceIncreaseCount > 1 ? 's' : ''}</span>
            )}
            {lapsedCount === 0 && priceIncreaseCount === 0 && (
              <span className="text-ink-300">no lapses or price increases</span>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h4 className="label mb-3">Detected Subscriptions</h4>
        {filteredSubs.length === 0 ? (
          <p className="text-xs text-ink-400 py-4">
            {report.subscriptions.length > 0
              ? 'No subscriptions match the current filters.'
              : taggedOnly
                ? 'No transactions categorized as "Subscriptions" in this window. Assign that category to a charge on the Transactions page to always include it here.'
                : 'No recurring charges detected yet. Subscriptions appear once the same merchant has been charged a few times at a regular interval — import more transaction history to get started.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <SubscriptionRows
              items={filteredSubs}
              onEdit={item => setEditingKey(item.merchant_key)}
              action={item =>
                item.is_manual && item.rule_id != null
                  ? {
                      label: 'Untrack',
                      onClick: () => deleteRule.mutate(item.rule_id!),
                      disabled: busy,
                    }
                  : {
                      label: 'Dismiss',
                      onClick: () =>
                        upsertRule.mutate({ merchant_key: item.merchant_key, rule: 'exclude' }),
                      disabled: busy,
                    }
              }
            />
          </div>
        )}
      </Card>

      {filteredDismissed.length > 0 && (
        <Card>
          <button
            onClick={() => setShowDismissed(v => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h4 className="label">Dismissed ({filteredDismissed.length})</h4>
            <span className="text-xs text-ink-400">{showDismissed ? 'Hide' : 'Show'}</span>
          </button>
          {showDismissed && (
            <div className="overflow-x-auto mt-3">
              <SubscriptionRows
                items={filteredDismissed}
                action={item => ({
                  label: 'Restore',
                  onClick: () => item.rule_id != null && deleteRule.mutate(item.rule_id),
                  disabled: busy,
                })}
              />
            </div>
          )}
        </Card>
      )}

      {filteredCandidates.length > 0 && (
        <Card>
          <button
            onClick={() => setShowCandidates(v => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h4 className="label">Possible Subscriptions ({filteredCandidates.length})</h4>
            <span className="text-xs text-ink-400">{showCandidates ? 'Hide' : 'Show'}</span>
          </button>
          {showCandidates && (
            <div className="mt-3 space-y-2">
              <p className="text-2xs text-ink-400">
                Repeated charges that didn't pass detection. Track one to include it in the
                report anyway.
              </p>
              {filteredCandidates.map(c => (
                <div
                  key={c.merchant_key}
                  className="flex items-center justify-between gap-3 rounded border border-white/[0.06] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-ink-100 truncate" title={c.display_name}>
                      {displayName(c)}
                    </div>
                    <div className="text-2xs text-ink-400">
                      {c.occurrence_count} charges · median {formatCurrency(c.median_amount)} ·
                      last {formatDateShort(c.last_charged)}
                      {c.category_name ? ` · ${c.category_name}` : ''} · {CANDIDATE_REASONS[c.reason]}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      upsertRule.mutate({ merchant_key: c.merchant_key, rule: 'include' })
                    }
                    disabled={busy}
                    className="shrink-0 text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
                  >
                    Track
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {editingItem && (
        <EditSubscriptionDialog
          key={editingItem.merchant_key}
          item={editingItem}
          report={report}
          onClose={() => setEditingKey(null)}
        />
      )}
    </div>
  )
}
