import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useCategories,
  useSubscriptionsReport,
  useUpsertSubscriptionRule,
  useDeleteSubscriptionRule,
  useSetSubscriptionNickname,
  useSetSubscriptionCadence,
  useSetSubscriptionStatus,
  useCreateManualSubscription,
  useUpdateManualSubscription,
  useDeleteManualSubscription,
  useResolveMerchantKeys,
  useLinkSubscriptions,
  useUnlinkSubscription,
  useDebouncedValue,
} from '@/hooks'
import { transactionsApi } from '@/lib/services'
import { Button, Card, CheckboxRow, FilterDropdown, Modal, Spinner } from '@/components/ui'
import {
  formatCurrency,
  formatCurrencyWhole,
  formatDateShort,
  formatTimeAgo,
  sortBySortOrder,
} from '@/lib/format'
import type { TimeAgoUnit } from '@/lib/format'
import type {
  SubscriptionCadence,
  SubscriptionCadenceBuiltin,
  SubscriptionCadenceOverride,
  SubscriptionItem,
  SubscriptionStatusOverride,
  SubscriptionsReport,
} from '@/types'
import clsx from 'clsx'

// A user-set interval the builtins can't express, e.g. 'every:6:weeks'.
const CUSTOM_CADENCE_RE = /^every:([1-9]\d?):(weeks|months)$/

type CadenceUnit = 'weeks' | 'months'

function parseCustomCadence(cadence: string): { n: number; unit: CadenceUnit } | null {
  const m = CUSTOM_CADENCE_RE.exec(cadence)
  return m ? { n: Number(m[1]), unit: m[2] as CadenceUnit } : null
}

// Mirrors _CUSTOM_EQUIVALENTS in backend/app/schemas/subscriptions.py: an
// interval that lands on a builtin one *is* that builtin, so both ends agree on
// one spelling and "unsaved changes" stays honest after the server canonicalizes.
const CUSTOM_EQUIVALENTS: Record<string, SubscriptionCadenceOverride> = {
  '1:weeks': 'weekly',
  '2:weeks': 'biweekly',
  '1:months': 'monthly',
  '3:months': 'quarterly',
  '6:months': 'semiannual',
  '12:months': 'annual',
}

const encodeCadence = (n: number, unit: CadenceUnit): SubscriptionCadenceOverride =>
  CUSTOM_EQUIVALENTS[`${n}:${unit}`] ?? (`every:${n}:${unit}` as SubscriptionCadenceOverride)

const BUILTIN_CADENCE_LABELS: Record<SubscriptionCadenceBuiltin, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Every 6 months',
  annual: 'Yearly',
  irregular: 'Irregular',
}

// A function rather than a Record: the cadence union is open-ended now, so
// a fixed key set can't index it.
function cadenceLabel(cadence: string): string {
  const custom = parseCustomCadence(cadence)
  if (custom) {
    const noun = custom.unit === 'weeks' ? 'week' : 'month'
    return custom.n === 1 ? `Every ${noun}` : `Every ${custom.n} ${noun}s`
  }
  // Fall back to the raw value rather than rendering nothing for a cadence
  // this build doesn't know about.
  return BUILTIN_CADENCE_LABELS[cadence as SubscriptionCadenceBuiltin] ?? cadence
}

// The unit a price change reads best in: a weekly plan's increase is "6 weeks
// ago", not "1 month ago". Irregular has no cadence to borrow, so use months.
const BUILTIN_AGO_UNIT: Record<SubscriptionCadenceBuiltin, TimeAgoUnit> = {
  weekly: 'week',
  biweekly: 'week',
  monthly: 'month',
  quarterly: 'month',
  semiannual: 'month',
  annual: 'year',
  irregular: 'month',
}

const cadenceAgoUnit = (cadence: string): TimeAgoUnit =>
  parseCustomCadence(cadence)?.unit === 'weeks'
    ? 'week'
    : BUILTIN_AGO_UNIT[cadence as SubscriptionCadenceBuiltin] ?? 'month'

// 'irregular' is only ever derived by detection, never settable as an override.
const CADENCE_OVERRIDE_OPTIONS: SubscriptionCadenceOverride[] = [
  'weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'annual',
]

const CADENCE_CUSTOM_MODE = 'custom'

const STATUS_OVERRIDE_OPTIONS: { value: SubscriptionStatusOverride; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const CANDIDATE_REASONS: Record<string, string> = {
  irregular_cadence: 'charges arrive at irregular intervals',
  amount_varies: 'amounts vary too much between charges',
  too_few_occurrences: 'not enough charges yet to confirm a pattern',
}

// Category groups hidden by default: recurring bills (rent, electricity, …)
// are technically subscriptions but usually noise on this report.
const DEFAULT_HIDDEN_GROUPS = new Set(['essential', 'utilities'])

const INPUT_CLASS =
  'w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40'

interface CategoryFilter {
  categoryIds: number[]
  includeUncategorized: boolean
}

// The user-chosen nickname wins over the derived merchant name everywhere.
const displayName = (x: { nickname?: string; display_name: string }) =>
  x.nickname || x.display_name

const dateOrDash = (iso?: string | null) => (iso ? formatDateShort(iso) : '—')

function StatusBadge({ item }: { item: SubscriptionItem }) {
  // A pinned 'inactive' still reports as lapsed from the API — only the label
  // separates the two, since one is a decision and the other a detection
  // result. Both are amber: neither counts toward the recurring totals.
  const isInactive = item.status_override === 'inactive'
  return (
    <span
      // 'Inactive' can only come from an override, so it says so already; a
      // pinned 'Active' is indistinguishable from a detected one without this.
      title={item.status_override === 'active' ? 'Manually set to active' : undefined}
      className={clsx(
        'inline-block rounded-full px-2 py-0.5 text-2xs font-medium',
        item.status === 'active' && !isInactive
          ? 'bg-teal-400/10 text-teal-400'
          : 'bg-amber-400/10 text-amber-400'
      )}
    >
      {isInactive ? 'Inactive' : item.status === 'active' ? 'Active' : 'Lapsed'}
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
          {/* The merchant name and its badges need the room; everything else
              is short and fixed-width. */}
          <th className="py-2 pr-3 font-medium w-[32%]">Merchant</th>
          <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Amount</th>
          <th className="py-2 pr-3 font-medium whitespace-nowrap">Cadence</th>
          <th className="py-2 pr-3 font-medium whitespace-nowrap">Last charged</th>
          <th className="py-2 pr-3 font-medium whitespace-nowrap">Next expected</th>
          <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Monthly eq.</th>
          <th className="py-2 pr-3 font-medium whitespace-nowrap">Status</th>
          <th className="py-2 font-medium" />
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const act = action(item)
          return (
            <tr
              key={item.merchant_key}
              onClick={onEdit ? () => onEdit(item) : undefined}
              className={clsx(
                'border-b border-white/[0.04] last:border-0',
                onEdit && 'cursor-pointer hover:bg-white/[0.02] transition-colors'
              )}
            >
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="truncate max-w-[340px] text-ink-100"
                    title={
                      item.nickname && !item.is_manual_entry
                        ? `${item.nickname} — detected as "${item.display_name}"`
                        : item.display_name
                    }
                  >
                    {displayName(item)}
                  </span>
                  {item.is_manual && (
                    <span className="shrink-0 rounded-full bg-sky-400/10 px-2 py-0.5 text-2xs text-sky-400">
                      manual
                    </span>
                  )}
                  {item.has_duplicates && (
                    <span
                      className="shrink-0 rounded-full bg-rose-400/10 px-2 py-0.5 text-2xs text-rose-400"
                      title={`Charged more than once in: ${item.duplicate_periods.join(', ')}`}
                    >
                      duplicate?
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
                  <div className="text-2xs text-rose-400 whitespace-nowrap">
                    ↑ from {formatCurrency(item.previous_amount)}
                    {item.price_increased_on &&
                      ` · ${formatTimeAgo(item.price_increased_on, cadenceAgoUnit(item.cadence))}`}
                  </div>
                )}
              </td>
              <td className="py-2.5 pr-3 text-ink-200">{cadenceLabel(item.cadence)}</td>
              <td className="py-2.5 pr-3 text-ink-200">{dateOrDash(item.last_charged)}</td>
              <td className="py-2.5 pr-3 text-ink-200">{dateOrDash(item.next_expected)}</td>
              <td className="py-2.5 pr-3 text-right font-mono text-ink-100">
                {formatCurrency(item.monthly_equivalent)}
              </td>
              <td className="py-2.5 pr-3">
                <StatusBadge item={item} />
              </td>
              {/* Row clicks open the editor, so the action button has to keep
                  its own click to itself. */}
              <td
                className="py-2.5 text-right whitespace-nowrap"
                onClick={e => e.stopPropagation()}
              >
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

/** Debounced transaction search with checkboxes — the way both dialogs turn
 *  charges the user recognizes into the merchant keys the report groups by. */
function TransactionPicker({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<number>
  onToggle: (id: number) => void
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search.trim(), 300)
  const { data: results, isFetching } = useQuery({
    queryKey: ['transactions', 'sub-search', query],
    queryFn: () => transactionsApi.list({ search: query, transaction_type: 'debit', limit: 25 }),
    enabled: query.length >= 2,
  })

  return (
    <>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search transactions by description or merchant…"
        className={`${INPUT_CLASS} mb-1`}
      />
      {query.length < 2 ? (
        <p className="text-xs text-ink-400 px-2 py-2">
          Type at least 2 characters to search your charges.
        </p>
      ) : isFetching && !results ? (
        <div className="flex justify-center py-3">
          <Spinner size="sm" />
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto">
          {(results ?? []).map(tx => (
            <CheckboxRow
              key={tx.id}
              checked={selected.has(tx.id)}
              label={tx.merchant_name || tx.description || tx.original_description}
              sublabel={`${formatDateShort(tx.date)} · ${formatCurrency(tx.amount)}${
                tx.account_name ? ` · ${tx.account_name}` : ''
              }`}
              disabled={disabled}
              onToggle={() => onToggle(tx.id)}
            />
          ))}
          {(results ?? []).length === 0 && (
            <p className="text-xs text-ink-400 px-2 py-2">No matching charges.</p>
          )}
        </div>
      )}
    </>
  )
}

/** Deduped merchant keys behind a set of picked transactions.
 *
 *  A subscription tracks merchants, not individual transactions: each picked
 *  charge resolves to its normalized merchant key, and every past and future
 *  charge under that key counts toward the subscription. */
function useMerchantKeysFor(selected: Set<number>): string[] {
  const ids = useMemo(() => Array.from(selected), [selected])
  const { data: resolutions } = useResolveMerchantKeys(ids)
  return useMemo(() => {
    const keys: string[] = []
    for (const r of resolutions ?? []) {
      if (!keys.includes(r.merchant_key)) keys.push(r.merchant_key)
    }
    return keys
  }, [resolutions])
}

const toggleIn = <T,>(prev: Set<T>, value: T) => {
  const next = new Set(prev)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** Cadence select, plus an interval + unit pair when "Custom…" is chosen.
 *
 *  Emits the wire value: '' for auto-detect, a builtin name, or an encoded
 *  'every:<n>:<weeks|months>' — canonicalized, so 1 / months emits 'monthly'.
 *  Emits null while a custom cadence is half-typed, so the caller can hold its
 *  Save button until the value means something.
 *
 *  Lays out as a single column (select on top, custom row beneath), which fits
 *  both the edit dialog's flex row and the add dialog's grid cell.
 */
function CadencePicker({
  value,
  onChange,
  allowAuto = true,
  disabled,
  className,
}: {
  value: string
  onChange: (next: string | null) => void
  allowAuto?: boolean
  disabled?: boolean
  className?: string
}) {
  const seeded = parseCustomCadence(value)
  // Seeded once, then owned locally: re-deriving `mode` from `value` would snap
  // the select back to "Monthly" the moment someone types the 1 of 12.
  const [mode, setMode] = useState(seeded ? CADENCE_CUSTOM_MODE : value)
  const [intervalText, setIntervalText] = useState(seeded ? String(seeded.n) : '')
  const [unit, setUnit] = useState<CadenceUnit>(seeded?.unit ?? 'months')

  const emit = (nextMode: string, nextInterval: string, nextUnit: CadenceUnit) => {
    if (nextMode !== CADENCE_CUSTOM_MODE) return onChange(nextMode)
    const n = Number(nextInterval)
    if (!Number.isInteger(n) || n < 1 || n > 99) return onChange(null)
    onChange(encodeCadence(n, nextUnit))
  }

  return (
    <div className={className}>
      <select
        value={mode}
        disabled={disabled}
        onChange={e => {
          setMode(e.target.value)
          emit(e.target.value, intervalText, unit)
        }}
        className={INPUT_CLASS}
      >
        {allowAuto && <option value="">Auto-detect</option>}
        {CADENCE_OVERRIDE_OPTIONS.map(c => (
          <option key={c} value={c}>
            {cadenceLabel(c)}
          </option>
        ))}
        <option value={CADENCE_CUSTOM_MODE}>Custom…</option>
      </select>
      {mode === CADENCE_CUSTOM_MODE && (
        <div className="flex gap-2 mt-1.5">
          <div className="w-16 shrink-0">
            <input
              type="number"
              min={1}
              max={99}
              step={1}
              value={intervalText}
              disabled={disabled}
              placeholder="6"
              aria-label="Cadence intervalText"
              onChange={e => {
                setIntervalText(e.target.value)
                emit(mode, e.target.value, unit)
              }}
              className={INPUT_CLASS}
            />
          </div>
          <select
            value={unit}
            disabled={disabled}
            aria-label="Cadence unit"
            onChange={e => {
              setUnit(e.target.value as CadenceUnit)
              emit(mode, intervalText, e.target.value as CadenceUnit)
            }}
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          >
            <option value="weeks">weeks</option>
            <option value="months">months</option>
          </select>
        </div>
      )}
    </div>
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
  const setCadence = useSetSubscriptionCadence()
  const setStatus = useSetSubscriptionStatus()
  const updateManual = useUpdateManualSubscription()
  const linkSubs = useLinkSubscriptions()
  const unlinkSub = useUnlinkSubscription()

  const [nickname, setNicknameText] = useState(item.nickname ?? '')
  // null while a custom cadence is half-typed — not saveable, not 'auto'.
  const [cadence, setCadenceValue] = useState<string | null>(item.cadence_override ?? '')
  const [statusValue, setStatusValue] = useState<string>(item.status_override ?? '')
  const [amount, setAmount] = useState(
    item.manual_amount != null ? String(item.manual_amount) : ''
  )
  const [startDate, setStartDate] = useState(item.manual_start_date ?? '')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedTxIds, setSelectedTxIds] = useState<Set<number>>(new Set())

  const busy =
    setNickname.isPending ||
    setCadence.isPending ||
    setStatus.isPending ||
    updateManual.isPending ||
    linkSubs.isPending ||
    unlinkSub.isPending

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
          sublabel: `${formatCurrency(s.amount)} · ${cadenceLabel(s.cadence)}`,
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

  // Keys from picked report rows and picked transactions land in the same
  // Link action; anything already part of this subscription is dropped.
  const txKeys = useMerchantKeysFor(selectedTxIds)
  const keysToLink = useMemo(() => {
    const owned = new Set([item.merchant_key, ...item.linked_merchants.map(m => m.key)])
    return Array.from(new Set([...selected, ...txKeys])).filter(k => !owned.has(k))
  }, [selected, txKeys, item.merchant_key, item.linked_merchants])

  const nicknameDirty = nickname.trim() !== (item.nickname ?? '')
  const saveNickname = () => {
    if (!nicknameDirty) return
    setNickname.mutate({
      merchant_key: item.merchant_key,
      nickname: nickname.trim() || undefined,
    })
  }

  const cadenceDirty = cadence !== null && cadence !== (item.cadence_override ?? '')
  const saveCadence = () => {
    if (!cadenceDirty) return
    setCadence.mutate({
      merchant_key: item.merchant_key,
      cadence: (cadence || undefined) as SubscriptionCadenceOverride | undefined,
    })
  }

  const statusDirty = statusValue !== (item.status_override ?? '')
  const saveStatus = () => {
    if (!statusDirty) return
    setStatus.mutate({
      merchant_key: item.merchant_key,
      status: (statusValue || undefined) as SubscriptionStatusOverride | undefined,
    })
  }

  const detailDirty =
    amount !== (item.manual_amount != null ? String(item.manual_amount) : '') ||
    startDate !== (item.manual_start_date ?? '')
  const saveDetail = () => {
    if (!detailDirty) return
    const parsed = Number(amount)
    updateManual.mutate({
      merchant_key: item.merchant_key,
      amount: amount.trim() && parsed > 0 ? parsed : undefined,
      start_date: startDate || undefined,
    })
  }

  const linkSelected = () =>
    linkSubs.mutate(
      { target_key: item.merchant_key, merchant_keys: keysToLink },
      {
        onSuccess: () => {
          setSelected(new Set())
          setSelectedTxIds(new Set())
        },
      }
    )

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-medium text-ink-100 mb-1">Edit subscription</h3>
      <p className="text-xs text-ink-400 mb-4 truncate" title={item.display_name}>
        {item.is_manual_entry ? 'added manually' : `detected as “${item.display_name}”`}
      </p>

      <div className="space-y-5">
        <div>
          <label className="label block mb-1.5">Name</label>
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={e => setNicknameText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveNickname()}
              placeholder={item.display_name}
              className={`min-w-0 flex-1 ${INPUT_CLASS}`}
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
            {item.is_manual_entry
              ? 'What this subscription is called.'
              : 'Shown in place of the detected name. Leave empty to clear.'}
          </p>
        </div>

        <div>
          <label className="label block mb-1.5">Status</label>
          <div className="flex gap-2">
            <select
              value={statusValue}
              onChange={e => setStatusValue(e.target.value)}
              className={`min-w-0 flex-1 ${INPUT_CLASS}`}
            >
              <option value="">Auto — use detection</option>
              {STATUS_OVERRIDE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={saveStatus}
              loading={setStatus.isPending}
              disabled={busy || !statusDirty}
            >
              Save
            </Button>
          </div>
          <p className="text-2xs text-ink-400 mt-1">
            Auto marks a subscription lapsed once it stops being charged. Inactive pins it
            there, keeping its cost out of the recurring totals.
          </p>
        </div>

        <div>
          <label className="label block mb-1.5">Cadence</label>
          {/* items-start so Save stays on the select's line when the custom
              interval row appears beneath it. */}
          <div className="flex gap-2 items-start">
            <CadencePicker
              value={cadence ?? ''}
              onChange={setCadenceValue}
              // A manual entry has no charge series to infer a cadence from,
              // so it must keep one.
              allowAuto={!item.is_manual_entry}
              disabled={busy}
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              onClick={saveCadence}
              loading={setCadence.isPending}
              disabled={busy || !cadenceDirty}
            >
              Save
            </Button>
          </div>
          <p className="text-2xs text-ink-400 mt-1">
            Overrides the detected billing interval — affects monthly cost, next-expected
            date, lapse detection, and duplicate warnings. Custom covers intervals the
            presets miss, like every 6 weeks.
          </p>
        </div>

        {item.is_manual_entry && (
          <div>
            <label className="label block mb-1.5">Cost &amp; billing date</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className={`min-w-0 flex-1 ${INPUT_CLASS}`}
              />
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className={`min-w-0 flex-1 ${INPUT_CLASS}`}
              />
              <Button
                size="sm"
                onClick={saveDetail}
                loading={updateManual.isPending}
                disabled={busy || !detailDirty}
              >
                Save
              </Button>
            </div>
            <p className="text-2xs text-ink-400 mt-1">
              {item.occurrence_count > 0
                ? 'Kept as a fallback — the linked charges below are what the report uses.'
                : 'What this costs and when it bills, until charges are linked below.'}
            </p>
          </div>
        )}

        {item.has_duplicates && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-300">
            Charged more than once in: {item.duplicate_periods.join(', ')}. Possible
            duplicate subscription — totals are unaffected.
          </div>
        )}

        <div>
          <label className="label block mb-1.5">Linked merchants</label>
          <div className="space-y-1">
            {!item.is_manual_entry && (
              <div className="flex items-center justify-between gap-2 rounded border border-white/[0.06] px-3 py-1.5">
                <span className="text-sm text-ink-200 truncate" title={item.merchant_key}>
                  {item.display_name}
                </span>
                <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-2xs text-ink-400">
                  primary
                </span>
              </div>
            )}
            {item.linked_merchants.map(m => (
              <div
                key={m.key}
                className="flex items-center justify-between gap-2 rounded border border-white/[0.06] px-3 py-1.5"
              >
                <span className="text-sm text-ink-200 truncate" title={m.key}>
                  {m.display_name}
                </span>
                <button
                  onClick={() => unlinkSub.mutate({ merchant_key: m.key })}
                  disabled={busy}
                  className="shrink-0 text-xs text-ink-400 hover:text-rose-400 disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            ))}
            {item.is_manual_entry && item.linked_merchants.length === 0 && (
              <p className="text-xs text-ink-400">No charges attached yet.</p>
            )}
          </div>
          <p className="text-2xs text-ink-400 mt-1">
            All merchant names whose charges count toward this subscription.
          </p>
        </div>

        <div>
          <label className="label block mb-1.5">Attach charges</label>
          <p className="text-2xs text-ink-400 mb-2">
            Pick a transaction, or another row that is really this same subscription under a
            different name — its merchant is attached, so past and future charges count here.
          </p>

          <TransactionPicker
            selected={selectedTxIds}
            onToggle={id => setSelectedTxIds(prev => toggleIn(prev, id))}
            disabled={busy}
          />

          {options.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs text-ink-400 mb-1">…or from this report</p>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search merchants…"
                className={`${INPUT_CLASS} mb-1`}
              />
              <div className="max-h-48 overflow-y-auto">
                {visibleOptions.map(o => (
                  <CheckboxRow
                    key={o.key}
                    checked={selected.has(o.key)}
                    label={o.label}
                    sublabel={o.sublabel}
                    disabled={busy}
                    onToggle={() => setSelected(prev => toggleIn(prev, o.key))}
                  />
                ))}
                {visibleOptions.length === 0 && (
                  <p className="text-xs text-ink-400 px-2 py-2">No matches.</p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              variant="primary"
              onClick={linkSelected}
              loading={linkSubs.isPending}
              disabled={busy || keysToLink.length === 0}
            >
              Attach {keysToLink.length || ''}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function AddSubscriptionDialog({
  report,
  onClose,
}: {
  report: SubscriptionsReport
  onClose: () => void
}) {
  const createManual = useCreateManualSubscription()

  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  // Empty by default so attaching a charge lets detection infer the cadence
  // rather than silently pinning one.
  const [cadence, setCadence] = useState<string | null>('')
  const [startDate, setStartDate] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const merchantKeys = useMerchantKeysFor(selected)

  // Attaching a merchant that already belongs to another subscription moves
  // it there — warn so that isn't a surprise.
  const existingHome = (key: string): string | null => {
    for (const s of [...report.subscriptions, ...report.dismissed]) {
      if (s.merchant_key === key || s.linked_merchants.some(m => m.key === key)) {
        return displayName(s)
      }
    }
    return null
  }

  // With charges attached the detector supplies the amount and cadence;
  // without them, they're the only thing the report has to work from.
  const parsedAmount = Number(amount)
  const hasDetail = amount.trim().length > 0 && parsedAmount > 0 && !!cadence
  const canCreate =
    name.trim().length > 0 &&
    // A half-typed custom cadence is not 'auto': without this it would submit
    // as auto-detect with an amount attached.
    cadence !== null &&
    (merchantKeys.length > 0 || hasDetail) &&
    !createManual.isPending

  const create = () =>
    createManual.mutate(
      {
        name: name.trim(),
        merchant_keys: merchantKeys,
        amount: hasDetail ? parsedAmount : undefined,
        cadence: (cadence || undefined) as SubscriptionCadenceOverride | undefined,
        start_date: startDate || undefined,
      },
      { onSuccess: onClose }
    )

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-medium text-ink-100 mb-1">Add subscription</h3>
      <p className="text-xs text-ink-400 mb-4">
        Track a recurring charge the detector missed — or one with no charges yet. Attaching a
        transaction is optional; when you do, its merchant comes along so future charges count
        automatically.
      </p>

      <div className="space-y-5">
        <div>
          <label className="label block mb-1.5">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Gym membership"
            maxLength={120}
            className={INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label block mb-1.5">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="label block mb-1.5">Cadence</label>
            <CadencePicker value={cadence ?? ''} onChange={setCadence} />
          </div>
          <div>
            <label className="label block mb-1.5">Next charge</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <p className="text-2xs text-ink-400 -mt-3">
          Required unless you attach a charge below — then the report measures them from the
          charges instead, and anything you set here overrides that.
        </p>

        <div>
          <label className="label block mb-1.5">Attach transactions (optional)</label>
          <TransactionPicker
            selected={selected}
            onToggle={id => setSelected(prev => toggleIn(prev, id))}
            disabled={createManual.isPending}
          />
        </div>

        {merchantKeys.length > 0 && (
          <div>
            <label className="label block mb-1.5">Will track</label>
            <div className="flex flex-wrap gap-1.5">
              {merchantKeys.map(key => {
                const home = existingHome(key)
                return (
                  <span
                    key={key}
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-2xs',
                      home ? 'bg-amber-400/10 text-amber-300' : 'bg-cyan-400/10 text-cyan-400'
                    )}
                    title={home ? `Currently part of "${home}" — it will be moved here.` : key}
                  >
                    {key}
                    {home && ` (moved from ${home})`}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={createManual.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={create}
            loading={createManual.isPending}
            disabled={!canCreate}
          >
            Add subscription
          </Button>
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
  const [showAdd, setShowAdd] = useState(false)
  // Keyed by merchant_key (not the item object) so the open dialog reflects
  // the freshly refetched report after each nickname/link mutation.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  // null = user hasn't touched the filter; the computed default applies.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter | null>(null)

  const { data: report, isLoading } = useSubscriptionsReport({ months, tagged_only: taggedOnly })
  const { data: categories } = useCategories({ expense_only: true })
  const upsertRule = useUpsertSubscriptionRule()
  const deleteRule = useDeleteSubscriptionRule()
  const deleteManual = useDeleteManualSubscription()

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

  const busy = upsertRule.isPending || deleteRule.isPending || deleteManual.isPending

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

  // A manual entry has no merchant to fall back to, so removing it deletes
  // the subscription outright rather than just dropping a tracking decision.
  const rowAction = (item: SubscriptionItem) => {
    if (item.is_manual_entry) {
      return {
        label: 'Delete',
        onClick: () => item.rule_id != null && deleteManual.mutate(item.rule_id),
        disabled: busy,
      }
    }
    if (item.is_manual && item.rule_id != null) {
      return { label: 'Untrack', onClick: () => deleteRule.mutate(item.rule_id!), disabled: busy }
    }
    return {
      label: 'Dismiss',
      onClick: () => upsertRule.mutate({ merchant_key: item.merchant_key, rule: 'exclude' }),
      disabled: busy,
    }
  }

  // Summary values reflect the category filter, so they're recomputed here
  // rather than taken from the server totals.
  const activeSubs = filteredSubs.filter(s => s.status === 'active')
  const totalMonthly = activeSubs.reduce((sum, s) => sum + s.monthly_equivalent, 0)
  const totalAnnual = activeSubs.reduce((sum, s) => sum + s.annual_equivalent, 0)
  // Split the same way the badge is: a hand-pinned 'inactive' isn't a lapse.
  const nonActive = filteredSubs.filter(s => s.status !== 'active')
  const inactiveCount = nonActive.filter(s => s.status_override === 'inactive').length
  const lapsedCount = nonActive.length - inactiveCount
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
          <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
            Add subscription
          </Button>
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
            {inactiveCount > 0 && (
              <span className="text-amber-400">{inactiveCount} inactive</span>
            )}
            {priceIncreaseCount > 0 && (
              <span className="text-rose-400">{priceIncreaseCount} price increase{priceIncreaseCount > 1 ? 's' : ''}</span>
            )}
            {lapsedCount === 0 && inactiveCount === 0 && priceIncreaseCount === 0 && (
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
                : 'No recurring charges detected yet. Subscriptions appear once the same merchant has been charged a few times at a regular interval — import more transaction history, or add one manually.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <SubscriptionRows
              items={filteredSubs}
              onEdit={item => setEditingKey(item.merchant_key)}
              action={rowAction}
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
                onEdit={item => setEditingKey(item.merchant_key)}
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

      {showAdd && <AddSubscriptionDialog report={report} onClose={() => setShowAdd(false)} />}
    </div>
  )
}
