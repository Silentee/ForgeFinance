import { useState } from 'react'
import { useAccounts, useDeleteAccount, useCreateAccount, useUpdateAccount, useUpdateBalance, useBalanceHistory, useUpdateBalanceSnapshot, useDeleteBalanceSnapshot } from '@/hooks'
import { Card, PageHeader, Button, AccountTypeDot, EmptyState, Spinner, Modal } from '@/components/ui'
import { formatCurrency, formatCurrencyWhole, formatDate, formatAccountType } from '@/lib/format'
import { importsApi } from '@/lib/services'
import type { Account, AccountCreate, AccountUpdate, AccountType } from '@/types'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'

const ASSET_TYPES: AccountType[] = [
  'checking', 'savings', 'hysa', 'cash', 'precious_metal', 'investment', 'retirement', 'hsa', 'real_estate', 'vehicle', 'other_asset',
]

const LIABILITY_TYPES: AccountType[] = [
  'credit_card', 'mortgage', 'car_loan', 'student_loan', 'personal_loan', 'other_liability',
]

function AccountTypeSelect({ value, onChange, required }: { value?: AccountType; onChange: (t: AccountType) => void; required?: boolean }) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value as AccountType)}
      required={required}
      className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
    >
      <option value="" disabled>Select account type...</option>
      <optgroup label="Assets">
        {ASSET_TYPES.map(t => (
          <option key={t} value={t}>{formatAccountType(t)}</option>
        ))}
      </optgroup>
      <optgroup label="Liabilities">
        {LIABILITY_TYPES.map(t => (
          <option key={t} value={t}>{formatAccountType(t)}</option>
        ))}
      </optgroup>
    </select>
  )
}

function AddAccountModal({ allAccounts, onClose }: { allAccounts: Account[]; onClose: () => void }) {
  const create = useCreateAccount()
  const { data: presets } = useQuery({ queryKey: ['import-presets'], queryFn: importsApi.getPresets })
  const [form, setForm] = useState<Partial<AccountCreate> & { name: string }>({
    name: '', currency: 'USD',
    is_active: true, include_in_net_worth: true,
  })

  // Check if the selected account type is an asset (not a liability)
  const isAssetType = form.account_type && !LIABILITY_TYPES.includes(form.account_type)

  // Get available liabilities for linking
  const availableLiabilities = allAccounts.filter(a => a.is_liability)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.account_type) return
    await create.mutateAsync(form as AccountCreate)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-base font-semibold text-ink-100 mb-5">Add Account</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label block mb-1.5">Account Name</label>
          <input
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Chase Checking"
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors"
          />
        </div>
        <div>
          <label className="label block mb-1.5">Account Type</label>
          <AccountTypeSelect
            value={form.account_type}
            onChange={t => setForm(f => ({ ...f, account_type: t, linked_liability_id: undefined }))}
            required
          />
        </div>
        <div>
          <label className="label block mb-1.5">Initial Balance (optional)</label>
          <input
            type="number"
            step="0.01"
            value={form.initial_balance ?? ''}
            onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value ? parseFloat(e.target.value) : undefined }))}
            placeholder="0.00"
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors"
          />
        </div>

        {/* Linked Liability dropdown (only for asset types) */}
        {isAssetType && availableLiabilities.length > 0 && (
          <div>
            <label className="label block mb-1.5">Linked Liability (optional)</label>
            <select
              value={form.linked_liability_id ?? ''}
              onChange={e => setForm(f => ({ ...f, linked_liability_id: e.target.value ? parseInt(e.target.value) : undefined }))}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
            >
              <option value="">None</option>
              {availableLiabilities.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({formatCurrency(l.current_balance)})
                </option>
              ))}
            </select>
            <p className="text-2xs text-ink-400 mt-1">Link to a mortgage, car loan, etc. to track equity</p>
          </div>
        )}

        <div>
          <label className="label block mb-1.5">Default CSV Format (optional)</label>
          <select
            value={form.default_csv_preset ?? ''}
            onChange={e => setForm(f => ({ ...f, default_csv_preset: e.target.value || null }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
          >
            <option value="">None</option>
            {presets && Object.keys(presets).map(k => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </option>
            ))}
          </select>
          <p className="text-2xs text-ink-400 mt-1">Pre-selects this format when importing CSVs for this account</p>
        </div>
        <div>
          <label className="label block mb-1.5">Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors resize-none"
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!(form.include_in_net_worth ?? true)}
              onChange={e => setForm(f => ({ ...f, include_in_net_worth: !e.target.checked }))}
              className="accent-amber-400"
            />
            <span className="text-sm text-ink-200">Exclude from totals</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!(form.is_active ?? true)}
              onChange={e => setForm(f => ({ ...f, is_active: !e.target.checked }))}
              className="accent-amber-400"
            />
            <span className="text-sm text-ink-200">Inactive account</span>
          </label>
          {isAssetType && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_liquid ?? (form.account_type ? ['checking', 'savings', 'hysa', 'cash', 'precious_metal', 'investment'].includes(form.account_type) : false)}
                onChange={e => setForm(f => ({ ...f, is_liquid: e.target.checked }))}
                className="accent-amber-400"
              />
              <span className="text-sm text-ink-200">Liquid asset</span>
            </label>
          )}
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending} className="flex-1">Add Account</Button>
        </div>
      </form>
    </Modal>
  )
}

type AccountDetailTab = 'details' | 'history'

type BalanceHistoryItem = {
  id: number
  date: string
  balance: number
  balance_type: string
}

function AccountDetailModal({
  account,
  allAccounts,
  initialTab = 'details',
  onClose,
}: {
  account: Account
  allAccounts: Account[]
  initialTab?: AccountDetailTab
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<AccountDetailTab>(initialTab)

  // === Edit Account State ===
  const update = useUpdateAccount(account.id)
  const deleteAccount = useDeleteAccount()
  const { data: presets } = useQuery({ queryKey: ['import-presets'], queryFn: importsApi.getPresets })
  const [form, setForm] = useState<AccountUpdate>({
    name: account.name,
    account_type: account.account_type,
    is_active: account.is_active,
    include_in_net_worth: account.include_in_net_worth,
    is_liquid: account.is_liquid,
    notes: account.notes,
    default_csv_preset: account.default_csv_preset,
    linked_liability_id: account.linked_liability_id,
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const availableLiabilities = allAccounts.filter(a => a.is_liability && a.id !== account.id)
  const linkedAssets = account.linked_assets ?? []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await update.mutateAsync(form)
    onClose()
  }

  const handleDelete = async () => {
    await deleteAccount.mutateAsync(account.id)
    onClose()
  }

  // === Balance History State ===
  const { data: historyData, isLoading: historyLoading } = useBalanceHistory(account.id, 100)
  const history = (historyData ?? []) as BalanceHistoryItem[]

  const updateSnapshot = useUpdateBalanceSnapshot(account.id)
  const deleteSnapshot = useDeleteBalanceSnapshot(account.id)
  const addBalance = useUpdateBalance(account.id)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editBalance, setEditBalance] = useState('')

  // Add new entry state
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [newEntryDate, setNewEntryDate] = useState(() => new Date().toISOString().split('T')[0])
  const [newEntryBalance, setNewEntryBalance] = useState('')

  const startEdit = (item: BalanceHistoryItem) => {
    setEditingId(item.id)
    setEditDate(item.date)
    setEditBalance(String(item.balance))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDate('')
    setEditBalance('')
  }

  const handleSnapshotSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    await updateSnapshot.mutateAsync({
      snapshotId: editingId,
      data: {
        snapshot_date: editDate,
        balance: parseFloat(editBalance),
      },
    })
    cancelEdit()
  }

  const handleSnapshotDelete = (item: BalanceHistoryItem) => {
    if (!confirm('Delete this balance entry? This cannot be undone.')) return
    deleteSnapshot.mutate(item.id)
  }

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    const balance = parseFloat(newEntryBalance)
    if (Number.isNaN(balance)) return
    await addBalance.mutateAsync({ balance, date: newEntryDate })
    setShowAddEntry(false)
    setNewEntryBalance('')
    setNewEntryDate(new Date().toISOString().split('T')[0])
  }

  return (
    <Modal onClose={onClose} className="max-w-2xl max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)]">
      {/* Header with account name */}
      <div className="flex items-center gap-2 mb-4">
        <AccountTypeDot isLiability={account.is_liability} />
        <h2 className="text-base font-semibold text-ink-100">{account.name}</h2>
        {account.mask && <span className="text-ink-400 font-mono text-xs">...{account.mask}</span>}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/[0.06] mb-4">
        {[
          { id: 'details' as const, label: 'Details' },
          { id: 'history' as const, label: 'Balance History' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-amber-400'
                : 'text-ink-300 hover:text-ink-100'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {/* Details Tab */}
      {activeTab === 'details' && (
        <>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label block mb-1.5">Account Name</label>
              <input
                required
                value={form.name ?? ''}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chase Checking"
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors"
              />
            </div>
            <div>
              <label className="label block mb-1.5">Account Type</label>
              <AccountTypeSelect
                value={form.account_type ?? account.account_type}
                onChange={t => setForm(f => ({ ...f, account_type: t }))        }
      />
            </div>
            <div>
              <label className="label block mb-1.5">Default CSV Format (optional)</label>
              <select
                value={form.default_csv_preset ?? ''}
                onChange={e => setForm(f => ({ ...f, default_csv_preset: e.target.value || null }))}
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
              >
                <option value="">None</option>
                {presets && Object.keys(presets).map(k => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            {/* Linked Liability dropdown (only for asset accounts) */}
            {!account.is_liability && availableLiabilities.length > 0 && (
              <div>
                <label className="label block mb-1.5">Linked Liability (for equity tracking)</label>
                <select
                  value={form.linked_liability_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, linked_liability_id: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
                >
                  <option value="">None</option>
                  {availableLiabilities.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({formatCurrency(l.current_balance)})
                    </option>
                  ))}
                </select>
                <p className="text-2xs text-ink-400 mt-1">Link to a mortgage, car loan, etc. to track equity</p>
              </div>
            )}

            {/* Show linked assets (for liability accounts) */}
            {account.is_liability && linkedAssets.length > 0 && (
              <div>
                <label className="label block mb-1.5">Linked Assets</label>
                <div className="bg-surface-700/50 border border-white/[0.06] rounded-lg px-3 py-2">
                  {linkedAssets.map(asset => (
                    <div key={asset.id} className="flex items-center justify-between text-sm">
                      <span className="text-ink-200">{asset.name}</span>
                      <span className="text-ink-400 font-mono text-xs">{formatCurrencyWhole(asset.current_balance)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-2xs text-ink-400 mt-1">This account is linked from the asset(s) above</p>
              </div>
            )}

            <div>
          <label className="label block mb-1.5">Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-400 focus:outline-none focus:border-amber-400/40 transition-colors resize-none"
          />
        </div>
        <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!(form.include_in_net_worth ?? true)}
                  onChange={e => setForm(f => ({ ...f, include_in_net_worth: !e.target.checked }))}
                  className="accent-amber-400"
                />
                <span className="text-sm text-ink-200">Exclude from totals</span>
              </label>
              {!account.is_liability && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_liquid ?? false}
                    onChange={e => setForm(f => ({ ...f, is_liquid: e.target.checked }))}
                    className="accent-amber-400"
                  />
                  <span className="text-sm text-ink-200">Liquid asset</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!(form.is_active ?? true)}
                  onChange={e => setForm(f => ({ ...f, is_active: !e.target.checked }))}
                  className="accent-amber-400"
                />
                <span className="text-sm text-ink-200">Inactive account</span>
              </label>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" variant="primary" loading={update.isPending} className="flex-1">Save</Button>
            </div>
          </form>

          {/* Delete section */}
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            {showDeleteConfirm ? (
              <div className="space-y-3">
                <p className="text-sm text-rose-400">
                  Delete "{account.name}"? This will also delete all its transactions. This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <Button type="button" variant="ghost" onClick={() => setShowDeleteConfirm(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="button" variant="danger" loading={deleteAccount.isPending} onClick={handleDelete} className="flex-1">
                    Delete Account
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="danger" onClick={() => setShowDeleteConfirm(true)} className="w-full">
                Delete Account
              </Button>
            )}
          </div>
        </>
      )}

      {/* Balance History Tab */}
      {activeTab === 'history' && (
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Add Entry Form */}
          {showAddEntry ? (
            <form onSubmit={handleAddEntry} className="mb-4 p-4 bg-surface-700/50 rounded-lg border border-white/[0.06]">
              <div className="text-sm font-medium text-ink-100 mb-3">Add Balance Entry</div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label block mb-1">Date</label>
                  <input
                    type="date"
                    value={newEntryDate}
                    onChange={e => setNewEntryDate(e.target.value)}
                    className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
                  />
                </div>
                <div className="flex-1">
                  <label className="label block mb-1">Balance</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newEntryBalance}
                    onChange={e => setNewEntryBalance(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40"
                  />
                </div>
                <Button type="submit" variant="primary" size="sm" loading={addBalance.isPending}>
                  Add
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddEntry(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="mb-4">
              <Button type="button" variant="primary" size="sm" onClick={() => setShowAddEntry(true)}>
                + Add Balance Entry
              </Button>
            </div>
          )}

          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-ink-400 py-4">No balance history yet.</p>
          ) : (
            <form onSubmit={handleSnapshotSave}>
              <div className="flex items-center gap-2 pb-1.5 border-b border-white/[0.06] text-2xs text-ink-400 font-mono uppercase tracking-wide">
                <span className="flex-1">Date</span>
                <span className="w-28 text-right">Balance</span>
                <span className="w-14 text-center">Type</span>
                <span className="w-28" />
              </div>
              <div className="divide-y divide-white/[0.04]">
                {history.map(item => {
                  const isEditing = editingId === item.id
                  return (
                    <div key={item.id} className="flex items-center gap-2 py-2">
                      {isEditing ? (
                        <>
                          <input
                            type="date"
                            value={editDate}
                            onChange={e => setEditDate(e.target.value)}
                            className="flex-1 min-w-0 bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-xs text-ink-100"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={editBalance}
                            onFocus={e => e.target.select()}
                            onChange={e => setEditBalance(e.target.value)}
                            className="w-28 bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-xs font-mono text-ink-100"
                          />
                          <div className="flex gap-1.5 flex-shrink-0">
                            <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                            <Button type="submit" size="sm" variant="primary" loading={updateSnapshot.isPending}>Save</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-xs text-ink-200">{formatDate(item.date)}</span>
                          <span className="w-28 text-right text-xs font-mono text-ink-100">{formatCurrency(item.balance)}</span>
                          <span className="w-14 text-center text-2xs font-mono text-ink-400 uppercase">{item.balance_type}</span>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(item)}>Edit</Button>
                            <Button type="button" size="sm" variant="danger" loading={deleteSnapshot.isPending} onClick={() => handleSnapshotDelete(item)}>Delete</Button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </form>
          )}

          <div className="flex justify-end gap-3 mt-5">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function isBalanceStale(balanceUpdatedAt: string | undefined): boolean {
  if (!balanceUpdatedAt) return false
  // Slice YYYY-MM directly to avoid timezone-induced month shifts
  const updatedYM = balanceUpdatedAt.slice(0, 7)
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevYM = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
  return updatedYM < prevYM
}

function AccountRow({
  account,
  linkedLiability,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onOpenModal,
  isSaving,
  showLinkedEquity = true,
}: {
  account: Account
  linkedLiability?: Account
  isEditing: boolean
  editValue: string
  onEditValueChange: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onOpenModal: () => void
  isSaving: boolean
  showLinkedEquity?: boolean
}) {
  const equity = linkedLiability
    ? (account.current_balance ?? 0) - (linkedLiability.current_balance ?? 0)
    : null

  return (
    <div
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer"
      onClick={onOpenModal}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <AccountTypeDot isLiability={account.is_liability} />
          <span className="text-sm font-medium text-ink-100">
            {account.name}
          </span>
          {account.mask && <span className="text-ink-400 font-mono text-2xs">...{account.mask}</span>}
          {!account.include_in_net_worth && <span className="badge badge-ink">excluded</span>}
          {!account.is_active && <span className="badge badge-ink">inactive</span>}
        </div>
        {account.balance_updated_at && (
          <p className="text-2xs text-ink-400 mt-0.5 ml-5">Updated {formatDate(account.balance_updated_at)}</p>
        )}
      </div>
      <div className="text-right" onClick={e => e.stopPropagation()}>
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.01"
              autoFocus
              onFocus={e => e.target.select()}
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSaveEdit()
                if (e.key === 'Escape') onCancelEdit()
              }}
              className="w-28 bg-surface-700 border border-white/[0.08] rounded-lg px-2 py-1 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors text-right"
            />
            <Button size="sm" variant="primary" loading={isSaving} onClick={onSaveEdit}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1.5">
              {isBalanceStale(account.balance_updated_at) && account.current_balance != null && (
                <span title="Balance hasn't been updated in over a month" className="text-amber-400 text-xs leading-none">⚠</span>
              )}
              <button
                type="button"
                onClick={onStartEdit}
                className={clsx(
                  'font-mono text-sm px-2 py-1 -mx-2 -my-1 rounded hover:bg-white/[0.06] transition-colors',
                  account.is_liability ? 'text-rose-400' : 'text-ink-100'
                )}
              >
                {formatCurrencyWhole(account.current_balance)}
              </button>
            </div>
            {equity !== null && showLinkedEquity && (
              <div className="text-2xs text-amber-400 font-mono mt-0.5">
                {formatCurrencyWhole(equity)} equity
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function AccountsPage() {
  const { data: accounts, isLoading } = useAccounts({ active_only: false })
  const [showAdd, setShowAdd] = useState(false)
  const [detailAccount, setDetailAccount] = useState<Account | null>(null)
  const [editingBalanceAccountId, setEditingBalanceAccountId] = useState<number | null>(null)
  const [editingBalanceValue, setEditingBalanceValue] = useState<string>('')
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [assetLiquidOnly, setAssetLiquidOnly] = useState(false)
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const todayStr = new Date().toISOString().slice(0, 10)
  const [effectiveDate, setEffectiveDate] = useState(todayStr)
  const isCustomDate = effectiveDate !== todayStr

  const toggleTypeCollapsed = (type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const updateBalance = useUpdateBalance(editingBalanceAccountId ?? 0)

  const startInlineEdit = (account: Account) => {
    setEditingBalanceAccountId(account.id)
    setEditingBalanceValue(String(account.current_balance ?? ''))
  }

  const cancelInlineEdit = () => {
    setEditingBalanceAccountId(null)
    setEditingBalanceValue('')
  }

  const saveInlineEdit = async () => {
    if (!editingBalanceAccountId) return
    const parsed = parseFloat(editingBalanceValue)
    if (Number.isNaN(parsed)) return
    await updateBalance.mutateAsync({ balance: parsed, date: effectiveDate })
    setEditingBalanceAccountId(null)
    setEditingBalanceValue('')
  }

  const assetAccounts = accounts?.filter(a => !a.is_liability && (showInactive || a.is_active)) ?? []
  const liabilityAccounts = accounts?.filter(a => a.is_liability && (showInactive || a.is_active)) ?? []

  // Linked equity pairs Ã¢â‚¬â€ assets with a linked liability, sorted consistently by asset name
  const linkedPairs = assetAccounts
    .filter(a => a.linked_liability_id)
    .map(asset => ({
      asset,
      liability: liabilityAccounts.find(l => l.id === asset.linked_liability_id),
    }))
    .filter((p): p is { asset: Account; liability: Account } => !!p.liability)
    .sort((a, b) => a.asset.name.localeCompare(b.asset.name))

  // Assets to show in the normal view (possibly filtered to liquid only)
  const displayedAssets = assetLiquidOnly
    ? assetAccounts.filter(a => a.is_liquid)
    : assetAccounts

  // Group by type
  const assetGroups: Record<string, Account[]> = {}
  for (const a of displayedAssets) {
    if (!assetGroups[a.account_type]) assetGroups[a.account_type] = []
    assetGroups[a.account_type].push(a)
  }

  const liabilityGroups: Record<string, Account[]> = {}
  for (const a of liabilityAccounts) {
    if (!liabilityGroups[a.account_type]) liabilityGroups[a.account_type] = []
    liabilityGroups[a.account_type].push(a)
  }

  const sortedAssetTypes = ASSET_TYPES.filter(t => assetGroups[t])
  const sortedLiabilityTypes = LIABILITY_TYPES.filter(t => liabilityGroups[t])

  const totalAssets = assetAccounts.filter(a => a.include_in_net_worth).reduce((s, a) => s + (a.current_balance ?? 0), 0)
  const totalLiabilities = liabilityAccounts.filter(a => a.include_in_net_worth).reduce((s, a) => s + (a.current_balance ?? 0), 0)
  const displayedAssetsTotal = displayedAssets.filter(a => a.include_in_net_worth).reduce((s, a) => s + (a.current_balance ?? 0), 0)

  const liquidAccounts = assetAccounts.filter(a => a.include_in_net_worth && a.is_liquid)
  const totalLiquidity = liquidAccounts.reduce((s, a) => s + (a.current_balance ?? 0), 0)
  const totalCash = liquidAccounts
    .filter(a => (['checking', 'savings', 'hysa', 'cash'] as AccountType[]).includes(a.account_type))
    .reduce((s, a) => s + (a.current_balance ?? 0), 0)
  const totalInvested = totalLiquidity - totalCash

  const linkedAssetTotal = linkedPairs.reduce((s, p) => s + (p.asset.include_in_net_worth ? (p.asset.current_balance ?? 0) : 0), 0)
  const linkedLiabilityTotal = linkedPairs.reduce((s, p) => s + (p.liability.include_in_net_worth ? (p.liability.current_balance ?? 0) : 0), 0)
  const linkedEquityTotal = linkedPairs.reduce((s, p) => s + ((p.asset.current_balance ?? 0) - (p.liability.current_balance ?? 0)), 0)

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title="Accounts"
        subtitle=""
        action={
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2">
              <span className="hidden md:inline text-xs text-ink-400 whitespace-nowrap">Snapshot date</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value || todayStr)}
                className={clsx(
                  'rounded-lg px-2.5 py-1.5 text-xs font-mono border focus:outline-none transition-colors',
                  isCustomDate
                    ? 'bg-amber-400/5 border-amber-400/40 text-amber-300'
                    : 'bg-surface-700 border-white/[0.08] text-ink-300'
                )}
              />
            </div>
            <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>+ Add Account</Button>
          </div>
        }
        extra={isCustomDate ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-400/5 border border-amber-400/20 rounded-lg text-xs text-amber-300">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
              <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5a1 1 0 112 0v3a1 1 0 11-2 0V5zm1 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            Balance updates will be recorded with snapshot date
            <button onClick={() => setEffectiveDate(todayStr)} className="ml-auto underline hover:no-underline">Reset to today</button>
          </div>
        ) : undefined}
      />

      {/* Summary tiles */}
      {/* Mobile order: Net Worth, Total Assets, Total Liquid, Total Liabilities, Cash, Liquid Investments */}
      {/* Desktop order: Net Worth, Total Assets, Total Liabilities, Total Liquid, Cash, Liquid Investments */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        <div className="order-1 md:order-1">
          <Card>
            <span className="label">Net Worth</span>
            <div className="stat-value mt-1 text-ink-100">{formatCurrencyWhole(totalAssets - totalLiabilities)}</div>
          </Card>
        </div>
        <div className="order-2 md:order-2">
          <Card>
            <span className="label">Total Assets</span>
            <div className="stat-value mt-1 value-positive">{formatCurrencyWhole(totalAssets)}</div>
          </Card>
        </div>
        <div className="order-3 md:order-4">
          <Card>
            <span className="label">Total Liquid</span>
            <div className="stat-value mt-1 text-white-400">{formatCurrencyWhole(totalLiquidity)}</div>
          </Card>
        </div>
        <div className="order-4 md:order-3">
          <Card>
            <span className="label">Total Liabilities</span>
            <div className="stat-value mt-1 value-negative">{formatCurrencyWhole(totalLiabilities)}</div>
          </Card>
        </div>
        <div className="order-5 md:order-5">
          <Card>
            <span className="label">Cash</span>
            <div className="stat-value mt-1 text-ink-100">{formatCurrencyWhole(totalCash)}</div>
          </Card>
        </div>
        <div className="order-6 md:order-6">
          <Card>
            <span className="label">Investments</span>
            <div className="stat-value mt-1 text-ink-100">{formatCurrencyWhole(totalInvested)}</div>
          </Card>
        </div>
      </div>

      {/* View mode toggle + liquid filter */}
      {!isLoading && (accounts?.length ?? 0) > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-surface-800/60 border border-white/[0.06] rounded-lg p-1">
            {([
              { id: false, label: 'All Accounts' },
              { id: true,  label: 'Linked Equity' },
            ] as const).map(mode => (
              <button
                key={String(mode.id)}
                onClick={() => {
                  setLinkedOnly(mode.id)
                  if (mode.id) setAssetLiquidOnly(false)
                }}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  linkedOnly === mode.id
                    ? 'bg-surface-700 text-amber-400 shadow-sm'
                    : 'text-ink-400 hover:text-ink-200'
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => !linkedOnly && setAssetLiquidOnly(v => !v)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              linkedOnly
                ? 'bg-surface-800/60 border-white/[0.06] text-ink-600 opacity-40 cursor-default'
                : assetLiquidOnly
                ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                : 'bg-surface-800/60 border-white/[0.06] text-ink-400 hover:text-ink-200'
            )}
          >
            Liquid only
          </button>

          <button
            onClick={() => setShowInactive(v => !v)}
            className={clsx(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              showInactive
                ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                : 'bg-surface-800/60 border-white/[0.06] text-ink-400 hover:text-ink-200'
            )}
          >
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : accounts?.length === 0 ? (
        <Card>
          <EmptyState
            title="No accounts yet"
            description="Add your first account to start tracking your finances."
            action={<Button variant="primary" onClick={() => setShowAdd(true)}>Add Account</Button>        }
      />
        </Card>
      ) : linkedOnly ? (
        linkedPairs.length === 0 ? (
          <Card>
            <EmptyState
              title="No linked pairs"
              description="Link an asset to a liability in account settings to track equity here."
            />
          </Card>
        ) : (
          <Card padding={false}>
            <div className="grid grid-cols-4 border-b border-white/[0.06]">
              <div className="px-5 py-3 bg-surface-800/40 border-r border-white/[0.06]">
                <span className="text-sm font-semibold text-ink-100">Linked Asset</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3 bg-amber-500/[0.03] border-r border-white/[0.06]">
                <span className="text-sm font-semibold text-ink-100">Equity</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3 bg-teal-600/[0.03] border-r border-white/[0.06]">
                <span className="text-sm font-semibold text-ink-100">Asset</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3 bg-rose-500/[0.03]">
                <span className="text-sm font-semibold text-ink-100">Liability</span>
              </div>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {linkedPairs.map(({ asset, liability }) => {
                const equity = (asset.current_balance ?? 0) - (liability.current_balance ?? 0)
                return (
                  <div key={asset.id} className="grid grid-cols-4 divide-x divide-white/[0.06] hover:bg-white/[0.02] transition-colors">
                    <div className="px-5 py-3.5 cursor-pointer" onClick={() => setDetailAccount(asset)}>
                      <div className="flex items-center gap-2 min-w-0">
                        <AccountTypeDot isLiability={false} />
                        <p className="text-sm font-medium text-ink-100 truncate">{asset.name}</p>
                      </div>
                      <p className="text-2xs text-ink-400 mt-0.5 ml-5 truncate">Linked liability: {liability.name}</p>
                    </div>

                    <div className="flex items-center justify-end px-5 py-3.5">
                      <span className={clsx("text-sm font-mono", equity >= 0 ? "text-amber-400" : "text-rose-400")}>
                        {formatCurrencyWhole(equity)}
                      </span>
                    </div>

                    <div className="flex items-center justify-end px-5 py-3.5 cursor-pointer" onClick={() => setDetailAccount(asset)}>
                      <span className="text-sm font-mono text-teal-400">{formatCurrencyWhole(asset.current_balance)}</span>
                    </div>

                    <div className="flex items-center justify-end px-5 py-3.5 cursor-pointer" onClick={() => setDetailAccount(liability)}>
                      <span className="text-sm font-mono text-rose-400">{formatCurrencyWhole(liability.current_balance)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      ) : (
        /* Normal Two-Card View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Assets Section */}
          {assetAccounts.length > 0 && (
            <Card padding={false}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-teal-500/[0.03]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-teal-400" />
                  <span className="text-sm font-semibold text-ink-100">Assets</span>
                </div>
                <span className="text-sm font-mono text-teal-400">
                  {formatCurrencyWhole(displayedAssetsTotal)}
                </span>
              </div>

              {sortedAssetTypes.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-400 text-center">No liquid accounts</p>
              ) : sortedAssetTypes.map((type, idx) => {
                const accts = assetGroups[type]
                const typeTotal = accts.filter(a => a.include_in_net_worth).reduce((s, a) => s + (a.current_balance ?? 0), 0)
                const isCollapsed = collapsedTypes.has(type)
                return (
                  <div key={type}>
                    <button
                      type="button"
                      onClick={() => toggleTypeCollapsed(type)}
                      className={clsx(
                        'w-full flex items-center justify-between px-5 py-2 bg-surface-800/50 hover:bg-surface-800 transition-colors',
                        idx > 0 && 'border-t border-white/[0.04]'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={clsx('w-3 h-3 text-ink-400 transition-transform duration-150', isCollapsed && '-rotate-90')}
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                        <span className={clsx('text-sm font-medium', isCollapsed ? 'text-ink-100' : 'text-ink-300')}>{formatAccountType(type)}</span>
                      </div>
                      <span className={clsx('text-sm font-mono', isCollapsed ? 'text-ink-100' : 'text-ink-400')}>{formatCurrencyWhole(typeTotal)}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-white/[0.04]">
                        {accts.map(account => {
                          const linkedLiability = account.linked_liability_id
                            ? liabilityAccounts.find(l => l.id === account.linked_liability_id)
                            : undefined
                          return (
                            <AccountRow
                              key={account.id}
                              account={account}
                              linkedLiability={linkedLiability}
                              isEditing={editingBalanceAccountId === account.id}
                              editValue={editingBalanceValue}
                              onEditValueChange={setEditingBalanceValue}
                              onStartEdit={() => startInlineEdit(account)}
                              onSaveEdit={saveInlineEdit}
                              onCancelEdit={cancelInlineEdit}
                              onOpenModal={() => setDetailAccount(account)}
                              isSaving={updateBalance.isPending}
                              showLinkedEquity={false        }
      />
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          )}

          {/* Liabilities Section */}
          {liabilityAccounts.length > 0 && !assetLiquidOnly && (
            <Card padding={false}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-rose-500/[0.03]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-400" />
                  <span className="text-sm font-semibold text-ink-100">Liabilities</span>
                </div>
                <span className="text-sm font-mono text-rose-400">
                  {formatCurrencyWhole(totalLiabilities)}
                </span>
              </div>

              {sortedLiabilityTypes.map((type, idx) => {
                const accts = liabilityGroups[type]
                const typeTotal = accts.filter(a => a.include_in_net_worth).reduce((s, a) => s + (a.current_balance ?? 0), 0)
                const isCollapsed = collapsedTypes.has(type)
                return (
                  <div key={type}>
                    <button
                      type="button"
                      onClick={() => toggleTypeCollapsed(type)}
                      className={clsx(
                        'w-full flex items-center justify-between px-5 py-2 bg-surface-800/50 hover:bg-surface-800 transition-colors',
                        idx > 0 && 'border-t border-white/[0.04]'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={clsx('w-3 h-3 text-ink-400 transition-transform duration-150', isCollapsed && '-rotate-90')}
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                        <span className={clsx('text-sm font-medium', isCollapsed ? 'text-ink-100' : 'text-ink-300')}>{formatAccountType(type)}</span>
                      </div>
                      <span className={clsx('text-sm font-mono', isCollapsed ? 'text-ink-100' : 'text-ink-400')}>{formatCurrencyWhole(typeTotal)}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-white/[0.04]">
                        {accts.map(account => (
                          <AccountRow
                            key={account.id}
                            account={account}
                            isEditing={editingBalanceAccountId === account.id}
                            editValue={editingBalanceValue}
                            onEditValueChange={setEditingBalanceValue}
                            onStartEdit={() => startInlineEdit(account)}
                            onSaveEdit={saveInlineEdit}
                            onCancelEdit={cancelInlineEdit}
                            onOpenModal={() => setDetailAccount(account)}
                            isSaving={updateBalance.isPending        }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          )}
        </div>
      )}

      {showAdd && <AddAccountModal allAccounts={accounts ?? []} onClose={() => setShowAdd(false)} />}
      {detailAccount && (
        <AccountDetailModal
          account={detailAccount}
          allAccounts={accounts ?? []}
          initialTab="details"
          onClose={() => setDetailAccount(null)        }
      />
      )}
    </div>
  )
}

