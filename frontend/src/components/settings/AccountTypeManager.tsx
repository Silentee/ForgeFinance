import { useState } from 'react'
import { Modal, Button, Spinner } from '@/components/ui'
import { useAccountTypes, useCreateAccountType, useUpdateAccountType, useDeleteAccountType } from '@/hooks'
import type { AccountTypeDef } from '@/types'
import clsx from 'clsx'

function EditableLabel({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const v = draft.trim()
    if (v && v !== value) onCommit(v)
    else setDraft(value)
  }
  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
      }}
      className="flex-1 min-w-0 bg-transparent border border-transparent hover:border-white/[0.08] focus:border-amber-400/40 focus:bg-surface-700 rounded px-2 py-1 text-sm text-ink-100 focus:outline-none transition-colors"
    />
  )
}

function ReorderButtons({ canUp, canDown, onUp, onDown }: {
  canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void
}) {
  return (
    <div className="flex flex-col">
      <button onClick={onUp} disabled={!canUp} className="text-ink-400 hover:text-ink-100 disabled:opacity-20 leading-none" aria-label="Move up">
        <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <button onClick={onDown} disabled={!canDown} className="text-ink-400 hover:text-ink-100 disabled:opacity-20 leading-none" aria-label="Move down">
        <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  )
}

export function AccountTypeManager({ onClose }: { onClose: () => void }) {
  const { data: types, isLoading } = useAccountTypes({ include_hidden: true })
  const createType = useCreateAccountType()
  const updateType = useUpdateAccountType()
  const deleteType = useDeleteAccountType()

  const [newLabel, setNewLabel] = useState('')
  const [newIsLiability, setNewIsLiability] = useState(false)
  const [newIsLiquid, setNewIsLiquid] = useState(false)

  const sorted = [...(types ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const assets = sorted.filter(t => !t.is_liability)
  const liabilities = sorted.filter(t => t.is_liability)

  const move = (items: AccountTypeDef[], index: number, dir: -1 | 1) => {
    const a = items[index]
    const b = items[index + dir]
    if (!a || !b) return
    updateType.mutate({ id: a.id, data: { sort_order: b.sort_order } })
    updateType.mutate({ id: b.id, data: { sort_order: a.sort_order } })
  }

  const remove = (t: AccountTypeDef) => {
    if (!confirm(`Delete account type "${t.label}"?`)) return
    deleteType.mutate(t.id)
  }

  const addType = () => {
    const label = newLabel.trim()
    if (!label) return
    createType.mutate(
      { label, is_liability: newIsLiability, is_liquid_default: newIsLiquid, sort_order: sorted.length },
      { onSuccess: () => { setNewLabel(''); setNewIsLiability(false); setNewIsLiquid(false) } },
    )
  }

  const Row = ({ t, index, list }: { t: AccountTypeDef; index: number; list: AccountTypeDef[] }) => (
    <div className={clsx('flex items-center gap-1.5 px-2 py-1', t.is_hidden && 'opacity-50')}>
      <ReorderButtons
        canUp={index > 0} canDown={index < list.length - 1}
        onUp={() => move(list, index, -1)} onDown={() => move(list, index, 1)}
      />
      <EditableLabel value={t.label} onCommit={label => updateType.mutate({ id: t.id, data: { label } })} />
      <label className="flex items-center gap-1 text-2xs text-ink-400 cursor-pointer whitespace-nowrap" title="Counts as a liquid asset by default">
        <input type="checkbox" checked={t.is_liquid_default} disabled={t.is_liability}
          onChange={e => updateType.mutate({ id: t.id, data: { is_liquid_default: e.target.checked } })}
          className="accent-amber-400" />
        Liquid
      </label>
      <button title={t.is_liability ? 'Mark as asset' : 'Mark as liability'}
        onClick={() => updateType.mutate({ id: t.id, data: { is_liability: !t.is_liability } })}
        className="text-2xs px-1.5 py-0.5 rounded border border-white/[0.08] text-ink-300 hover:bg-white/[0.06] whitespace-nowrap">
        {t.is_liability ? '→ Asset' : '→ Liability'}
      </button>
      {t.is_system ? (
        <button onClick={() => updateType.mutate({ id: t.id, data: { is_hidden: !t.is_hidden } })} title={t.is_hidden ? 'Show' : 'Hide'}
          className={clsx('p-1 rounded hover:bg-white/[0.06]', t.is_hidden ? 'text-ink-500' : 'text-ink-300')}>
          {t.is_hidden ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.03 10.03 0 003.505-4.475C18.268 6.943 14.478 4 10 4a9.94 9.94 0 00-3.242.54L3.28 2.22z"/></svg>
          )}
        </button>
      ) : (
        <button onClick={() => remove(t)} title="Delete"
          className="p-1 rounded text-rose-400 hover:bg-white/[0.06]">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
        </button>
      )}
    </div>
  )

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Manage Account Types</h2>
      <p className="text-xs text-ink-400 mb-4">
        Types drive asset/liability grouping and net worth. Liabilities subtract from net worth. Built-in types can be hidden; your own can be deleted (when unused).
      </p>

      {isLoading ? (
        <div className="py-8 flex justify-center"><Spinner /></div>
      ) : (
        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          <div>
            <p className="text-2xs uppercase tracking-wide text-teal-300/70 px-2 mb-1">Assets</p>
            <div className="rounded-lg border border-white/[0.06] bg-surface-800/50 divide-y divide-white/[0.04]">
              {assets.map((t, i) => <Row key={t.id} t={t} index={i} list={assets} />)}
            </div>
          </div>
          <div>
            <p className="text-2xs uppercase tracking-wide text-rose-300/70 px-2 mb-1">Liabilities</p>
            <div className="rounded-lg border border-white/[0.06] bg-surface-800/50 divide-y divide-white/[0.04]">
              {liabilities.map((t, i) => <Row key={t.id} t={t} index={i} list={liabilities} />)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <p className="text-2xs text-ink-500 uppercase tracking-wide mb-1.5">Add type</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addType() }}
            placeholder="New type name"
            className="flex-1 min-w-[8rem] bg-surface-700 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40" />
          <label className="flex items-center gap-1.5 text-xs text-ink-300 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={newIsLiability} onChange={e => setNewIsLiability(e.target.checked)} className="accent-amber-400" />
            Liability
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-300 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={newIsLiquid} disabled={newIsLiability} onChange={e => setNewIsLiquid(e.target.checked)} className="accent-amber-400" />
            Liquid
          </label>
          <Button size="sm" onClick={addType} loading={createType.isPending}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}
