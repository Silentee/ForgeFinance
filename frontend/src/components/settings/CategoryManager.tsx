import { useState } from 'react'
import { Modal, Button, Spinner } from '@/components/ui'
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from '@/hooks'
import { sortBySortOrder } from '@/lib/format'
import type { Category } from '@/types'
import clsx from 'clsx'

// Inline text that commits on blur / Enter, reverts on Escape.
function EditableName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
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

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { data: categories, isLoading } = useCategories({ include_hidden: true })
  const createCat = useCreateCategory()
  const updateCat = useUpdateCategory()
  const deleteCat = useDeleteCategory()

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupIncome, setNewGroupIncome] = useState(false)
  const [addingChildTo, setAddingChildTo] = useState<number | null>(null)
  const [newChildName, setNewChildName] = useState('')

  const groups = sortBySortOrder((categories ?? []).filter(c => c.children.length > 0 || c.parent_id == null))

  // Swap sort_order with an adjacent sibling to move an item up/down.
  const move = (items: Category[], index: number, dir: -1 | 1) => {
    const a = items[index]
    const b = items[index + dir]
    if (!a || !b) return
    updateCat.mutate({ id: a.id, data: { sort_order: b.sort_order } })
    updateCat.mutate({ id: b.id, data: { sort_order: a.sort_order } })
  }

  const rename = (c: Category, name: string) => updateCat.mutate({ id: c.id, data: { name } })
  const setColor = (c: Category, color: string) => updateCat.mutate({ id: c.id, data: { color } })
  const toggleHidden = (c: Category) => updateCat.mutate({ id: c.id, data: { is_hidden: !c.is_hidden } })

  const remove = (c: Category) => {
    if (c.children.length > 0) return
    if (!confirm(`Delete "${c.name}"? Transactions using it become uncategorized.`)) return
    deleteCat.mutate(c.id)
  }

  const addGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    createCat.mutate(
      { name, is_income: newGroupIncome, sort_order: groups.length },
      { onSuccess: () => { setNewGroupName(''); setNewGroupIncome(false) } },
    )
  }

  const addChild = (parent: Category) => {
    const name = newChildName.trim()
    if (!name) return
    createCat.mutate(
      { name, parent_id: parent.id, is_income: parent.is_income, sort_order: parent.children.length },
      { onSuccess: () => { setNewChildName(''); setAddingChildTo(null) } },
    )
  }

  // Row action buttons: hide/show for system categories, delete for custom ones.
  const RowActions = ({ c }: { c: Category }) => (
    c.is_system ? (
      <button onClick={() => toggleHidden(c)} title={c.is_hidden ? 'Show' : 'Hide'}
        className={clsx('p-1 rounded hover:bg-white/[0.06]', c.is_hidden ? 'text-ink-500' : 'text-ink-300')}>
        {c.is_hidden ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.03 10.03 0 003.505-4.475C18.268 6.943 14.478 4 10 4a9.94 9.94 0 00-3.242.54L3.28 2.22zM10 6a4 4 0 013.958 4.65l-4.608-4.608A4 4 0 0110 6z"/><path d="M6.5 8.5l4.5 4.5a4 4 0 01-4.5-4.5z"/></svg>
        )}
      </button>
    ) : (
      <button onClick={() => remove(c)} title="Delete" disabled={c.children.length > 0}
        className="p-1 rounded text-rose-400 hover:bg-white/[0.06] disabled:opacity-30">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
      </button>
    )
  )

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <h2 className="text-base font-semibold text-ink-100 mb-1">Manage Transaction Types</h2>
      <p className="text-xs text-ink-400 mb-4">
        Groups and their types flow through transactions, budgets and reports. Built-in items can be hidden; your own can be deleted.
      </p>

      {isLoading ? (
        <div className="py-8 flex justify-center"><Spinner /></div>
      ) : (
        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          {groups.map((group, gi) => {
            const children = sortBySortOrder(group.children)
            return (
              <div key={group.id} className="rounded-lg border border-white/[0.06] bg-surface-800/50">
                <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/[0.06]">
                  <ReorderButtons
                    canUp={gi > 0} canDown={gi < groups.length - 1}
                    onUp={() => move(groups, gi, -1)} onDown={() => move(groups, gi, 1)}
                  />
                  <EditableName value={group.name} onCommit={v => rename(group, v)} />
                  <span className="text-2xs uppercase tracking-wide text-ink-500 px-1">{group.is_income ? 'Income' : 'Expense'}</span>
                  <RowActions c={group} />
                </div>

                <div className="py-1">
                  {children.map((child, ci) => (
                    <div key={child.id} className={clsx('flex items-center gap-1.5 px-2 py-0.5 pl-4', child.is_hidden && 'opacity-50')}>
                      <ReorderButtons
                        canUp={ci > 0} canDown={ci < children.length - 1}
                        onUp={() => move(children, ci, -1)} onDown={() => move(children, ci, 1)}
                      />
                      <input type="color" value={child.color ?? '#6b7280'} onChange={e => setColor(child, e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-0 p-0" title="Color" />
                      <EditableName value={child.name} onCommit={v => rename(child, v)} />
                      <RowActions c={child} />
                    </div>
                  ))}

                  {addingChildTo === group.id ? (
                    <div className="flex items-center gap-2 px-2 py-1 pl-4">
                      <input autoFocus value={newChildName} onChange={e => setNewChildName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addChild(group); if (e.key === 'Escape') { setAddingChildTo(null); setNewChildName('') } }}
                        placeholder="New type name"
                        className="flex-1 bg-surface-700 border border-white/[0.08] rounded px-2 py-1 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40" />
                      <Button size="sm" onClick={() => addChild(group)} loading={createCat.isPending}>Add</Button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingChildTo(group.id); setNewChildName('') }}
                      className="text-xs text-amber-400/80 hover:text-amber-400 px-2 py-1 pl-4">+ Add type</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-white/[0.06]">
        <p className="text-2xs text-ink-500 uppercase tracking-wide mb-1.5">Add group</p>
        <div className="flex items-center gap-2">
          <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addGroup() }}
            placeholder="New group name"
            className="flex-1 bg-surface-700 border border-white/[0.08] rounded px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40" />
          <label className="flex items-center gap-1.5 text-xs text-ink-300 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={newGroupIncome} onChange={e => setNewGroupIncome(e.target.checked)} className="accent-amber-400" />
            Income
          </label>
          <Button size="sm" onClick={addGroup} loading={createCat.isPending}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}
