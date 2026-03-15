import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useAccounts, useImports, useUploadCsv, useDeleteImport, useImportBalanceCsv } from '@/hooks'
import { importsApi } from '@/lib/services'
import { Card, CardHeader, PageHeader, Button, Spinner } from '@/components/ui'
import { formatDate } from '@/lib/format'
import type { CSVImportResult, CSVColumnMapping } from '@/types'
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'

// ─── CSV preview parser ────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { field += ch }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(field); field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

function parseCSVPreview(text: string, maxRows = 10): string[][] {
  const rows: string[][] = []
  for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (rows.length >= maxRows) break
    if (line.trim() === '' && rows.length === 0) continue
    rows.push(parseCSVLine(line))
  }
  return rows
}

// ─── Column field types ────────────────────────────────────────────────────

type ColField =
  | '' | 'date' | 'amount' | 'description'
  | 'debit' | 'credit' | 'transaction_type'
  | 'merchant' | 'category'

const COL_OPTIONS: { value: ColField; label: string }[] = [
  { value: '',                  label: '— skip —' },
  { value: 'date',              label: 'Date' },
  { value: 'amount',            label: 'Amount' },
  { value: 'description',       label: 'Description' },
  { value: 'debit',             label: 'Debit Amount' },
  { value: 'credit',            label: 'Credit Amount' },
  { value: 'transaction_type',  label: 'Trans. Type' },
  { value: 'merchant',          label: 'Merchant' },
  { value: 'category',          label: 'Category' },
]

function autoDetectCols(headerRow: string[]): Record<number, ColField> {
  const m: Record<number, ColField> = {}
  for (let i = 0; i < headerRow.length; i++) {
    const h = headerRow[i].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (h === 'date' || h === 'transaction date') m[i] = 'date'
    else if (h === 'amount' || h === 'transaction amount') m[i] = 'amount'
    else if (['description', 'memo', 'payee', 'narrative', 'details', 'name', 'transaction details'].includes(h)) m[i] = 'description'
    else if (h === 'debit' || h === 'debit amount' || h === 'amount debit') m[i] = 'debit'
    else if (h === 'credit' || h === 'credit amount' || h === 'amount credit') m[i] = 'credit'
    else if (h === 'type' || h === 'transaction type') m[i] = 'transaction_type'
    else if (h === 'merchant' || h === 'merchant name') m[i] = 'merchant'
    else if (h === 'category') m[i] = 'category'
  }
  return m
}

// ─── Custom CSV Mapper component ───────────────────────────────────────────

function CsvCustomMapper({
  file,
  onImport,
  onCancel,
  isImporting,
}: {
  file: File
  onImport: (mapping: CSVColumnMapping) => void
  onCancel: () => void
  isImporting: boolean
}) {
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [skipRows, setSkipRows] = useState(0)
  const [colMappings, setColMappings] = useState<Record<number, ColField>>({})
  const [amountFormat, setAmountFormat] = useState<'signed' | 'absolute' | 'split'>('signed')
  const [dateFormat, setDateFormat] = useState('%m/%d/%Y')

  // Parse the file when it changes — read all rows for full scroll support
  useEffect(() => {
    setRawRows([])
    setParseError(null)
    setSkipRows(0)
    file.text()
      .then(text => setRawRows(parseCSVPreview(text, 2000)))
      .catch(e => setParseError(String(e)))
  }, [file])

  // Auto-detect column assignments whenever the header row changes
  useEffect(() => {
    if (rawRows.length > skipRows) {
      setColMappings(autoDetectCols(rawRows[skipRows]))
    }
  }, [rawRows, skipRows])

  const headerRow = rawRows[skipRows] ?? []
  const numCols = rawRows.reduce((n, r) => Math.max(n, r.length), 0)

  const handleImport = () => {
    // Build field-name map from col index assignments
    const byField: Partial<Record<ColField, string>> = {}
    for (const [ci, field] of Object.entries(colMappings)) {
      const name = headerRow[Number(ci)]
      if (field && name !== undefined) byField[field] = name
    }

    if (!byField.date) { alert('Please assign the Date column.'); return }
    if (!byField.description) { alert('Please assign the Description column.'); return }
    if (amountFormat === 'split') {
      if (!byField.debit || !byField.credit) {
        alert('Split format requires both a Debit and a Credit column to be assigned.')
        return
      }
    } else if (!byField.amount) {
      alert('Please assign the Amount column.')
      return
    }

    onImport({
      date: byField.date!,
      amount: byField.amount,
      description: byField.description!,
      debit_column: byField.debit,
      credit_column: byField.credit,
      transaction_type: byField.transaction_type,
      merchant: byField.merchant,
      category: byField.category,
      amount_format: amountFormat,
      date_format: dateFormat,
      skip_rows: skipRows,
    })
  }

  if (parseError) {
    return (
      <Card>
        <p className="text-sm text-rose-400 mb-3">Could not read CSV: {parseError}</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </Card>
    )
  }

  if (rawRows.length === 0) {
    return <Card><div className="flex justify-center py-8"><Spinner /></div></Card>
  }

  return (
    <Card className="animate-slide-up">
      {/* Card header */}
      <div className="flex items-start justify-between mb-5 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="text-sm font-medium text-ink-100">Configure Column Mapping</div>
          <div className="text-xs text-ink-400 mt-0.5 font-mono truncate max-w-sm">{file.name}</div>
        </div>
        <button
          onClick={onCancel}
          className="text-ink-400 hover:text-ink-200 transition-colors ml-4 flex-shrink-0"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <label className="label block mb-1.5">Header row offset</label>
          <div className="flex items-stretch">
            <input
              type="number"
              min={0}
              max={rawRows.length - 1}
              value={skipRows}
              onChange={e => setSkipRows(Math.max(0, Math.min(rawRows.length - 1, Number(e.target.value))))}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-l-lg px-3 py-2 text-sm font-mono text-ink-100 text-center focus:outline-none focus:border-amber-400/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <div className="flex flex-col border border-white/[0.08] border-l-0 rounded-r-lg overflow-hidden flex-shrink-0">
              <button
                type="button"
                onClick={() => setSkipRows(s => Math.min(rawRows.length - 1, s + 1))}
                disabled={skipRows >= rawRows.length - 1}
                className="flex-1 w-7 flex items-center justify-center bg-surface-700 hover:bg-white/[0.06] hover:text-amber-400 text-ink-400 border-b border-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg viewBox="0 0 8 5" fill="none" className="w-2.5 h-2.5"><path d="M1 4L4 1L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button
                type="button"
                onClick={() => setSkipRows(s => Math.max(0, s - 1))}
                disabled={skipRows === 0}
                className="flex-1 w-7 flex items-center justify-center bg-surface-700 hover:bg-white/[0.06] hover:text-amber-400 text-ink-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <svg viewBox="0 0 8 5" fill="none" className="w-2.5 h-2.5"><path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>
          <p className="text-2xs text-ink-400 mt-1">Rows above the column header row</p>
        </div>
        <div>
          <label className="label block mb-1.5">Date format</label>
          <input
            type="text"
            value={dateFormat}
            onChange={e => setDateFormat(e.target.value)}
            placeholder="%m/%d/%Y"
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40"
          />
          <p className="text-2xs text-ink-400 mt-1">Python strptime format</p>
        </div>
        <div>
          <label className="label block mb-1.5">Amount format</label>
          <select
            value={amountFormat}
            onChange={e => setAmountFormat(e.target.value as typeof amountFormat)}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
          >
            <option value="signed">Signed (+ income, − expense)</option>
            <option value="absolute">Absolute (always positive)</option>
            <option value="split">Split (separate debit/credit cols)</option>
          </select>
        </div>
      </div>

      {/* Preview table — scrollable, ~10 rows visible initially */}
      <div className="rounded-lg border border-white/[0.06] mb-5 overflow-hidden">
        <div className="overflow-auto max-h-[340px]">
        <table className="w-full text-xs border-collapse">
          {/* Mapping dropdowns — sticky so they stay visible while scrolling */}
          <thead className="sticky top-0 z-20">
            <tr className="bg-surface-700/80 border-b-2 border-white/[0.10]">
              <th className="sticky left-0 z-10 bg-surface-700/80 px-2 py-2 w-10 border-r border-white/[0.06] text-ink-500 font-normal text-center">
                row
              </th>
              {Array.from({ length: numCols }, (_, ci) => (
                <th key={ci} className="px-1.5 py-1.5 min-w-[140px] border-r border-white/[0.04] last:border-r-0 align-bottom">
                  <div className="relative">
                    <select
                      value={colMappings[ci] ?? ''}
                      onChange={e => setColMappings(p => ({ ...p, [ci]: e.target.value as ColField }))}
                      className={clsx(
                        'w-full appearance-none rounded px-1.5 pr-5 py-1 text-2xs font-medium focus:outline-none transition-colors [color-scheme:dark]',
                        colMappings[ci]
                          ? 'bg-amber-400/10 border border-amber-400/30 text-amber-300'
                          : 'bg-surface-700 border border-white/[0.08] text-ink-400'
                      )}
                    >
                      {COL_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-1.5 flex items-center pointer-events-none">
                      <svg viewBox="0 0 8 5" fill="none" className={clsx('w-2 h-2', colMappings[ci] ? 'text-amber-400/60' : 'text-ink-400')}>
                        <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Raw rows */}
          <tbody>
            {rawRows.map((row, ri) => {
              const isSkipped = ri < skipRows
              const isHeader = ri === skipRows
              return (
                <tr
                  key={ri}
                  className={clsx(
                    'border-b border-white/[0.04] last:border-0',
                    isSkipped && 'opacity-50',
                    isHeader && 'bg-amber-400/[0.07] border-b-2 border-amber-400/20',
                  )}
                >
                  {/* Row label */}
                  <td className={clsx(
                    'sticky left-0 z-10 px-2 py-1.5 border-r border-white/[0.04] text-center text-2xs font-mono w-10',
                    isSkipped && 'bg-surface-900/80 text-ink-500',
                    isHeader && 'bg-amber-400/[0.12] text-amber-400/70 font-semibold',
                    !isSkipped && !isHeader && 'bg-surface-800/50 text-ink-500',
                  )}>
                    {isHeader ? 'hdr' : ri}
                  </td>

                  {/* Cell values */}
                  {Array.from({ length: numCols }, (_, ci) => (
                    <td
                      key={ci}
                      title={row[ci] ?? ''}
                      className={clsx(
                        'px-2 py-1.5 max-w-[180px] truncate border-r border-white/[0.04] last:border-r-0 font-mono',
                        isSkipped && 'text-ink-500',
                        isHeader && 'text-amber-200/80 font-semibold',
                        !isSkipped && !isHeader && 'text-ink-300',
                      )}
                    >
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-400">
          {rawRows.length} rows &middot; header at row {skipRows}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isImporting}>Cancel</Button>
          <Button variant="primary" onClick={handleImport} loading={isImporting}>Import CSV</Button>
        </div>
      </div>
    </Card>
  )
}

// ─── Balance CSV Mapper ────────────────────────────────────────────────────

function BalanceCsvMapper({
  file,
  onImport,
  onCancel,
  isImporting,
}: {
  file: File
  onImport: (dateColumn: string, balanceColumn: string, dateFormat: string, skipRows: number) => void
  onCancel: () => void
  isImporting: boolean
}) {
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [skipRows, setSkipRows] = useState(0)
  const [dateFormat, setDateFormat] = useState('%m/%d/%Y')
  const [dateCol, setDateCol] = useState('')
  const [balanceCol, setBalanceCol] = useState('')

  useEffect(() => {
    setRawRows([])
    setParseError(null)
    setSkipRows(0)
    setDateCol('')
    setBalanceCol('')
    file.text()
      .then(text => setRawRows(parseCSVPreview(text, 2000)))
      .catch(e => setParseError(String(e)))
  }, [file])

  // Auto-detect columns from header
  useEffect(() => {
    if (rawRows.length <= skipRows) return
    const header = rawRows[skipRows]
    for (let i = 0; i < header.length; i++) {
      const h = header[i].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
      if (!dateCol && (h === 'date' || h.includes('date'))) setDateCol(header[i])
      if (!balanceCol && (h === 'balance' || h.includes('balance') || h.includes('amount'))) setBalanceCol(header[i])
    }
  }, [rawRows, skipRows])

  const headerRow = rawRows[skipRows] ?? []
  const numCols = rawRows.reduce((n, r) => Math.max(n, r.length), 0)

  const handleImport = () => {
    if (!dateCol) { alert('Please select the Date column.'); return }
    if (!balanceCol) { alert('Please select the Balance column.'); return }
    onImport(dateCol, balanceCol, dateFormat, skipRows)
  }

  if (parseError) {
    return (
      <Card>
        <p className="text-sm text-rose-400 mb-3">Could not read CSV: {parseError}</p>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </Card>
    )
  }

  if (rawRows.length === 0) {
    return <Card><div className="flex justify-center py-8"><Spinner /></div></Card>
  }

  const colOptions = headerRow.map(h => ({ value: h, label: h || '(empty)' }))

  return (
    <Card className="animate-slide-up">
      <div className="flex items-start justify-between mb-5 pb-4 border-b border-white/[0.06]">
        <div>
          <div className="text-sm font-medium text-ink-100">Map Balance History Columns</div>
          <div className="text-xs text-ink-400 mt-0.5 font-mono truncate max-w-sm">{file.name}</div>
        </div>
        <button onClick={onCancel} className="text-ink-400 hover:text-ink-200 transition-colors ml-4 flex-shrink-0">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div>
          <label className="label block mb-1.5">Date column</label>
          <select
            value={dateCol}
            onChange={e => setDateCol(e.target.value)}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
          >
            <option value="">— select —</option>
            {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label block mb-1.5">Balance column</label>
          <select
            value={balanceCol}
            onChange={e => setBalanceCol(e.target.value)}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
          >
            <option value="">— select —</option>
            {colOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label block mb-1.5">Date format</label>
          <input
            type="text"
            value={dateFormat}
            onChange={e => setDateFormat(e.target.value)}
            placeholder="%m/%d/%Y"
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 focus:outline-none focus:border-amber-400/40"
          />
        </div>
        <div>
          <label className="label block mb-1.5">Header row offset</label>
          <input
            type="number"
            min={0}
            max={rawRows.length - 1}
            value={skipRows}
            onChange={e => setSkipRows(Math.max(0, Math.min(rawRows.length - 1, Number(e.target.value))))}
            className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono text-ink-100 text-center focus:outline-none focus:border-amber-400/40"
          />
        </div>
      </div>

      {/* Preview table — highlights mapped columns */}
      <div className="rounded-lg border border-white/[0.06] mb-5 overflow-hidden">
        <div className="overflow-auto max-h-[300px]">
          <table className="w-full text-xs border-collapse">
            <tbody>
              {rawRows.map((row, ri) => {
                const isSkipped = ri < skipRows
                const isHeader = ri === skipRows
                return (
                  <tr key={ri} className={clsx(
                    'border-b border-white/[0.04] last:border-0',
                    isSkipped && 'opacity-40',
                    isHeader && 'bg-amber-400/[0.07] border-b-2 border-amber-400/20',
                  )}>
                    <td className={clsx(
                      'sticky left-0 z-10 px-2 py-1.5 border-r border-white/[0.04] text-center text-2xs font-mono w-10',
                      isSkipped ? 'bg-surface-900/80 text-ink-500' : isHeader ? 'bg-amber-400/[0.12] text-amber-400/70 font-semibold' : 'bg-surface-800/50 text-ink-500',
                    )}>
                      {isHeader ? 'hdr' : ri}
                    </td>
                    {Array.from({ length: numCols }, (_, ci) => {
                      const cellVal = row[ci] ?? ''
                      const colName = headerRow[ci] ?? ''
                      const isDate = colName === dateCol
                      const isBal = colName === balanceCol
                      return (
                        <td key={ci} title={cellVal} className={clsx(
                          'px-2 py-1.5 max-w-[200px] truncate border-r border-white/[0.04] last:border-r-0 font-mono',
                          isSkipped ? 'text-ink-500' : isHeader ? 'text-amber-200/80 font-semibold' : 'text-ink-300',
                          !isSkipped && !isHeader && isDate && 'bg-blue-400/[0.06] text-blue-300',
                          !isSkipped && !isHeader && isBal && 'bg-teal-400/[0.06] text-teal-300',
                          isHeader && isDate && 'bg-blue-400/20 text-blue-300',
                          isHeader && isBal && 'bg-teal-400/20 text-teal-300',
                        )}>
                          {cellVal}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-ink-400">
          {dateCol && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400/40 inline-block" />Date: <span className="text-blue-300 font-mono">{dateCol}</span></span>}
          {balanceCol && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-400/40 inline-block" />Balance: <span className="text-teal-300 font-mono">{balanceCol}</span></span>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isImporting}>Cancel</Button>
          <Button variant="primary" onClick={handleImport} loading={isImporting}>Import</Button>
        </div>
      </div>
    </Card>
  )
}

// ─── Format examples ───────────────────────────────────────────────────────

interface FormatExample {
  label: string
  note: string
  csv: string
}

const FORMAT_EXAMPLES: Record<string, FormatExample> = {
  chase_checking: {
    label: 'Chase Checking',
    note: 'Signed amounts — negative = expense, positive = income. Category column is optional.',
    csv: 'Transaction Date,Description,Amount,Category\n01/15/2025,GROCERY STORE,-52.34,Food & Drink\n01/16/2025,PAYROLL DIRECT DEP,2500.00,Payroll',
  },
  chase_credit: {
    label: 'Chase Credit',
    note: 'Signed amounts — charges are negative, payments/credits are positive.',
    csv: 'Transaction Date,Description,Amount,Category\n01/15/2025,AMAZON.COM,-34.99,Shopping\n01/20/2025,AUTOPAY PAYMENT,500.00,Payments',
  },
  bank_of_america: {
    label: 'Bank of America',
    note: 'Signed amounts — negative = expense, positive = income. Category column is optional.',
    csv: 'Date,Description,Amount,Running Bal.,Category\n01/15/2025,GROCERY STORE,-52.34,1247.66,Groceries\n01/16/2025,DIRECT DEP,2500.00,3747.66,Income',
  },
  wells_fargo: {
    label: 'Wells Fargo',
    note: 'Signed amounts — negative = expense, positive = income. No category column.',
    csv: 'Date,Description,Amount\n01/15/2025,GROCERY STORE,-52.34\n01/16/2025,PAYROLL DEPOSIT,2500.00',
  },
  fidelity: {
    label: 'Fidelity',
    note: 'Split debit/credit columns — leave one blank per row. No category column.',
    csv: 'Date,Description,Debit,Credit\n01/15/2025,GROCERY STORE,52.34,\n01/16/2025,DIRECT DEPOSIT,,2500.00',
  },
  capital_one: {
    label: 'Capital One',
    note: 'Split debit/credit columns, ISO date format (YYYY-MM-DD). Category column is optional.',
    csv: 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2025-01-15,2025-01-16,1234,GROCERY STORE,Groceries,52.34,\n2025-01-16,2025-01-17,1234,PAYROLL DEP,Income,,2500.00',
  },
  american_express: {
    label: 'American Express',
    note: 'Signed amounts — charges are negative, credits/payments are positive. Category column is optional.',
    csv: 'Date,Description,Amount,Category\n01/15/2025,AMAZON.COM,-34.99,Merchandise & Supplies\n01/20/2025,PAYMENT,-500.00,Fees & Adjustments',
  },
  schwab_checking: {
    label: 'Schwab Checking',
    note: 'Split withdrawal/deposit columns — leave one blank per row. No category column.',
    csv: 'Date,Description,Withdrawal,Deposit,RunningBalance\n01/15/2025,GROCERY STORE,52.34,,1247.66\n01/16/2025,PAYROLL,,2500.00,3747.66',
  },
  USAA_checking: {
    label: 'USAA Checking',
    note: 'Signed amounts with ISO date format (YYYY-MM-DD). Category column is optional.',
    csv: 'Date,Description,Original Description,Category,Amount,Status\n2025-01-15,GROCERY STORE,GROCERY STORE 1234,Groceries,-52.34,Posted\n2025-01-16,PAYROLL DEP,PAYROLL DIRECT DEP,Paycheck,2500.00,Posted',
  },
  USAA_credit: {
    label: 'USAA Credit',
    note: 'Signed amounts with ISO date format (YYYY-MM-DD). Category column is optional.',
    csv: 'Date,Description,Original Description,Category,Amount,Status\n2025-01-15,GROCERY STORE,GROCERY STORE 1234,Groceries,-52.34,Posted\n2025-01-16,PAYROLL DEP,PAYROLL DIRECT DEP,Paycheck,2500.00,Posted',
  },
  pentucket_bank: {
    label: 'Pentucket Bank',
    note: 'Split debit/credit columns. File has 3 metadata rows before the header — set "Header row offset" to 3.',
    csv: 'Account Name: My Checking\nAccount Number: 1234567890\nDate Range: 01/01/2025 to 01/31/2025\nDate,Description,Amount Debit,Amount Credit\n01/15/2025,GROCERY STORE,52.34,\n01/16/2025,PAYROLL,,2500.00',
  },
  generic: {
    label: 'Generic',
    note: 'Expects standard column names. Use "Custom" if your bank uses different headers.',
    csv: 'Date,Description,Amount\n01/15/2025,Grocery Store,-52.34\n01/16/2025,Payroll Deposit,2500.00',
  },
  custom: {
    label: 'Custom',
    note: 'Drop your CSV file below to preview it and manually assign which column is the date, amount, description, etc.',
    csv: '',
  },
  balance_history: {
    label: 'Balance History',
    note: 'One row per date with a balance value. Extra columns are ignored. Balances can include $ signs and commas.',
    csv: 'Date,Balance,Notes\n01/31/2025,15234.56,End of month\n12/31/2024,13872.11,\n11/30/2024,$12,500.00,',
  },
}

// ─── Main page ─────────────────────────────────────────────────────────────

type ImportMode = 'transactions' | 'balance_history'

export default function ImportPage() {
  const { data: accounts } = useAccounts()
  const { data: imports, isLoading: importsLoading } = useImports()
  const { data: presets } = useQuery({ queryKey: ['import-presets'], queryFn: importsApi.getPresets })
  const uploadCsv = useUploadCsv()
  const importBalanceCsv = useImportBalanceCsv()

  const deleteImport = useDeleteImport()

  const [importMode, setImportMode] = useState<ImportMode>('transactions')
  const [accountId, setAccountId] = useState<number | ''>('')
  const [preset, setPreset] = useState('')
  const [result, setResult] = useState<CSVImportResult | null>(null)
  const [customFile, setCustomFile] = useState<File | null>(null)
  const [fallbackFile, setFallbackFile] = useState<File | null>(null)
  const [fallbackPreset, setFallbackPreset] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  // Balance history import state
  const [balAccountId, setBalAccountId] = useState<number | ''>('')
  const [balFile, setBalFile] = useState<File | null>(null)
  const [balResult, setBalResult] = useState<{ imported: number; errors: string[] } | null>(null)

  // When account changes, use its default preset or reset to empty
  const handleAccountChange = (newAccountId: number | '') => {
    setAccountId(newAccountId)
    const account = newAccountId && accounts ? accounts.find(a => a.id === newAccountId) : null
    setPreset(account?.default_csv_preset ?? '')
  }

  // Clear custom file when switching away from custom mode
  useEffect(() => {
    if (preset !== 'custom') setCustomFile(null)
  }, [preset])

  const onDrop = useCallback(async (files: File[]) => {
    if (!accountId || !preset || files.length === 0) return
    const file = files[0]

    if (preset === 'custom') {
      // Show the mapping UI instead of uploading immediately
      setResult(null)
      setCustomFile(file)
      return
    }

    try {
      const res = await uploadCsv.mutateAsync({ accountId: Number(accountId), file, preset })
      // If zero rows imported, fall back to custom mapper so user can adjust settings
      if (!res.is_successful || res.transactions_imported === 0) {
        setFallbackFile(file)
        setFallbackPreset(preset)
        setResult(null)
      } else {
        setResult(res)
      }
    } catch {
      // Import errored — show the custom mapper so user can fix column settings
      setFallbackFile(file)
      setFallbackPreset(preset)
    }
  }, [accountId, preset, uploadCsv])

  const handleCustomImport = async (mapping: CSVColumnMapping) => {
    if (!accountId || !customFile) return
    try {
      const res = await uploadCsv.mutateAsync({ accountId: Number(accountId), file: customFile, mapping })
      setResult(res)
      setCustomFile(null)
    } catch {}
  }

  const handleFallbackImport = async (mapping: CSVColumnMapping) => {
    if (!accountId || !fallbackFile) return
    // Preserve the preset's category_map so bank categories still get mapped
    const presetCategoryMap = presets?.[fallbackPreset]?.category_map
    const mergedMapping: CSVColumnMapping = presetCategoryMap
      ? { ...mapping, category_map: presetCategoryMap }
      : mapping
    try {
      const res = await uploadCsv.mutateAsync({ accountId: Number(accountId), file: fallbackFile, mapping: mergedMapping })
      setResult(res)
      setFallbackFile(null)
      setFallbackPreset('')
    } catch {}
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'] },
    maxFiles: 1,
    disabled: !accountId || !preset || uploadCsv.isPending,
  })

  // Balance history dropzone
  const onBalDrop = useCallback((files: File[]) => {
    if (!balAccountId || files.length === 0) return
    setBalResult(null)
    setBalFile(files[0])
  }, [balAccountId])

  const { getRootProps: getBalRootProps, getInputProps: getBalInputProps, isDragActive: isBalDragActive } = useDropzone({
    onDrop: onBalDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv'] },
    maxFiles: 1,
    disabled: !balAccountId || importBalanceCsv.isPending,
  })

  const handleBalanceImport = async (dateCol: string, balCol: string, dateFmt: string, skipRows: number) => {
    if (!balAccountId || !balFile) return
    try {
      const res = await importBalanceCsv.mutateAsync({
        accountId: Number(balAccountId),
        file: balFile,
        dateColumn: dateCol,
        balanceColumn: balCol,
        dateFormat: dateFmt,
        skipRows,
      })
      setBalResult(res)
      setBalFile(null)
    } catch {}
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader
        title="Import"
        subtitle=""
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload form */}
        <div className="lg:col-span-2 space-y-4">

          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-surface-800 rounded-lg border border-white/[0.06] w-fit">
            {([
              { value: 'transactions', label: 'Transactions' },
              { value: 'balance_history', label: 'Balance History' },
            ] as { value: ImportMode; label: string }[]).map(opt => (
              <button
                key={opt.value}
                onClick={() => { setImportMode(opt.value); setResult(null); setBalResult(null) }}
                className={clsx(
                  'px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
                  importMode === opt.value
                    ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                    : 'text-ink-400 hover:text-ink-200'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── Transactions import ── */}
          {importMode === 'transactions' && (<>
          <Card>
            <CardHeader title="Upload CSV" />

            {/* Account selector */}
            <div className="mb-4">
              <label className="label block mb-1.5">Account</label>
              <select
                value={accountId}
                onChange={e => handleAccountChange(e.target.value ? Number(e.target.value) : '')}
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
              >
                <option value="">Select an account...</option>
                {accounts?.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {/* Bank format preset */}
            <div className="mb-5">
              <label className="label block mb-1.5">Bank Format</label>
              <select
                value={preset}
                onChange={e => setPreset(e.target.value)}
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
              >
                <option value="" disabled>Select a format...</option>
                {presets
                  ? Object.keys(presets).map(k => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </option>
                  ))
                  : <option value="generic">Generic</option>
                }
                <option value="custom">Custom</option>
              </select>
              <p className="text-2xs text-ink-400 mt-1.5">
                {!preset
                  ? 'Choose the format that matches your bank\'s CSV export.'
                  : preset === 'custom'
                  ? 'Drop a CSV file below to preview and map its columns.'
                  : "Preset loaded. Drop a CSV file to import."}
              </p>
            </div>

            {/* Drop zone — hidden once a file is loaded in custom mode */}
            {!(preset === 'custom' && customFile) && (
              <div
                {...getRootProps()}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 cursor-pointer',
                  (!accountId || !preset) && 'opacity-40 cursor-not-allowed',
                  isDragActive
                    ? 'border-amber-400/60 bg-amber-400/5'
                    : 'border-white/[0.10] hover:border-white/[0.20] hover:bg-white/[0.02]'
                )}
              >
                <input {...getInputProps()} />
                {uploadCsv.isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Spinner size="lg" />
                    <p className="text-sm text-ink-300">Importing...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-ink-400">
                      <rect x="8" y="8" width="32" height="40" rx="4" stroke="currentColor" strokeWidth="2"/>
                      <path d="M16 28l8-8 8 8M24 20v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M16 14h16M16 38h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
                    </svg>
                    {isDragActive ? (
                      <p className="text-amber-400 text-sm font-medium">Drop it here</p>
                    ) : (
                      <>
                        <p className="text-ink-200 text-sm">
                          {!accountId
                            ? 'Select an account first'
                            : !preset
                            ? 'Select a bank format first'
                            : 'Drag & drop a CSV file, or click to browse'}
                        </p>
                        <p className="text-ink-400 text-xs">Supports .csv files up to 50MB</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Custom mapper — shown after a file is dropped in custom mode */}
          {preset === 'custom' && customFile && (
            <CsvCustomMapper
              file={customFile}
              onImport={handleCustomImport}
              onCancel={() => setCustomFile(null)}
              isImporting={uploadCsv.isPending}
            />
          )}

          {/* Fallback mapper — shown when a preset import fails or imports 0 rows */}
          {fallbackFile && (
            <>
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-400/10 border border-amber-400/20 rounded-lg text-xs text-amber-300">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                Import failed — adjust the column mapping or date format below and try again. The preset's category map will still be applied.
              </div>
              <CsvCustomMapper
                file={fallbackFile}
                onImport={handleFallbackImport}
                onCancel={() => { setFallbackFile(null); setFallbackPreset('') }}
                isImporting={uploadCsv.isPending}
              />
            </>
          )}

          {/* Import result */}
          {result && (
            <Card className="animate-slide-up">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/[0.06]">
                <div className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm',
                  result.is_successful ? 'bg-teal-400/10 text-teal-400' : 'bg-rose-400/10 text-rose-400'
                )}>
                  {result.is_successful ? '✓' : '✗'}
                </div>
                <div>
                  <p className="text-sm font-medium text-ink-100">
                    {result.is_successful ? 'Import Successful' : 'Import Failed'}
                  </p>
                  <p className="text-xs text-ink-300">{result.file_name}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="label mb-1">Imported</div>
                  <div className="font-mono text-2xl text-teal-400">{result.transactions_imported}</div>
                </div>
                <div>
                  <div className="label mb-1">Skipped (duplicates)</div>
                  <div className="font-mono text-2xl text-ink-300">{result.transactions_skipped}</div>
                </div>
              </div>

              {result.date_range_start && (
                <p className="text-xs text-ink-300 mb-3">
                  Date range: {formatDate(result.date_range_start)} → {formatDate(result.date_range_end ?? '')}
                </p>
              )}

              {result.errors.length > 0 && (
                <div className="bg-surface-900/60 rounded-lg p-3">
                  <div className="label mb-2">Parse warnings ({result.errors.length})</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-2xs text-rose-400 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
          </>)}

          {/* ── Balance history import ── */}
          {importMode === 'balance_history' && (<>
          <Card>
            <CardHeader title="Upload Balance History CSV" />
            <div className="mb-5">
              <label className="label block mb-1.5">Account</label>
              <select
                value={balAccountId}
                onChange={e => { setBalAccountId(e.target.value ? Number(e.target.value) : ''); setBalFile(null); setBalResult(null) }}
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-amber-400/40 transition-colors"
              >
                <option value="">Select an account...</option>
                {accounts?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="text-2xs text-ink-400 mt-1.5">
                CSV should have at least a date column and a balance column.
              </p>
            </div>

            {!balFile && (
              <div
                {...getBalRootProps()}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 cursor-pointer',
                  !balAccountId && 'opacity-40 cursor-not-allowed',
                  isBalDragActive
                    ? 'border-amber-400/60 bg-amber-400/5'
                    : 'border-white/[0.10] hover:border-white/[0.20] hover:bg-white/[0.02]'
                )}
              >
                <input {...getBalInputProps()} />
                <div className="flex flex-col items-center gap-3">
                  <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-ink-400">
                    <rect x="8" y="8" width="32" height="40" rx="4" stroke="currentColor" strokeWidth="2"/>
                    <path d="M16 28l8-8 8 8M24 20v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M16 14h16M16 38h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
                  </svg>
                  {isBalDragActive ? (
                    <p className="text-amber-400 text-sm font-medium">Drop it here</p>
                  ) : (
                    <p className="text-ink-200 text-sm">
                      {!balAccountId ? 'Select an account first' : 'Drag & drop a CSV file, or click to browse'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {balFile && (
            <BalanceCsvMapper
              file={balFile}
              onImport={handleBalanceImport}
              onCancel={() => setBalFile(null)}
              isImporting={importBalanceCsv.isPending}
            />
          )}

          {balResult && (
            <Card className="animate-slide-up">
              <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/[0.06]">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-teal-400/10 text-teal-400">✓</div>
                <p className="text-sm font-medium text-ink-100">Balance History Imported</p>
              </div>
              <div className="mb-4">
                <div className="label mb-1">Entries imported</div>
                <div className="font-mono text-2xl text-teal-400">{balResult.imported}</div>
              </div>
              {balResult.errors.length > 0 && (
                <div className="bg-surface-900/60 rounded-lg p-3">
                  <div className="label mb-2">Parse warnings ({balResult.errors.length})</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {balResult.errors.map((err, i) => (
                      <p key={i} className="text-2xs text-rose-400 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
          </>)}
        </div>

        {/* Import history sidebar */}
        <div>
          <Card padding={false}>
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <span className="label">Import History</span>
            </div>
            {importsLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !imports?.length ? (
              <div className="px-5 py-8 text-center text-sm text-ink-400">No imports yet</div>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto">
                {imports.slice(0, 20).map((imp, idx, arr) => {
                  const isConfirming = confirmDeleteId === imp.id
                  const isDeleting = deleteImport.isPending && confirmDeleteId === imp.id
                  const currentDate = new Date(imp.imported_at)
                  const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
                  const previous = arr[idx - 1]
                  const previousDate = previous ? new Date(previous.imported_at) : null
                  const previousMonthKey = previousDate
                    ? `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`
                    : null
                  const showMonthDivider = idx === 0 || currentMonthKey !== previousMonthKey
                  const monthLabel = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })

                  return (
                    <div key={imp.id} className="border-b border-white/[0.04] last:border-b-0">
                      {showMonthDivider && (
                        <div className="px-5 py-2 bg-surface-900/40 border-y border-white/[0.06]">
                          <span className="text-2xs font-medium uppercase tracking-wide text-ink-400">{monthLabel}</span>
                        </div>
                      )}

                      <div className="px-5 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-ink-200 truncate">{imp.file_name ?? 'Manual'}</p>
                            <p className="text-2xs text-ink-400 mt-0.5">{formatDate(imp.imported_at)}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-xs font-mono text-teal-400">+{imp.transactions_imported}</p>
                              {imp.transactions_skipped > 0 && (
                                <p className="text-2xs text-ink-400 font-mono">{imp.transactions_skipped} skipped</p>
                              )}
                            </div>
                            {imp.transactions_imported > 0 && !isConfirming && (
                              <button
                                onClick={() => setConfirmDeleteId(imp.id)}
                                title="Remove transactions from this import"
                                className="text-ink-500 hover:text-rose-400 transition-colors p-0.5"
                              >
                                <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                                  <path d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6 7v5M10 7v5M3 4l.8 9a.5.5 0 00.5.5h7.4a.5.5 0 00.5-.5L13 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>

                        {!imp.is_successful && (
                          <p className="text-2xs text-rose-400 mt-1 truncate">{imp.error_message}</p>
                        )}

                        {isConfirming && (
                          <div className="mt-2 pt-2 border-t border-white/[0.06]">
                            <p className="text-2xs text-ink-300 mb-2">
                              Remove {imp.transactions_imported} transaction{imp.transactions_imported !== 1 ? 's' : ''} from this import?
                            </p>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={isDeleting}
                                className="flex-1 text-2xs px-2 py-1 rounded bg-surface-700 hover:bg-white/[0.06] text-ink-300 transition-colors disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  await deleteImport.mutateAsync({ id: imp.id, deleteTransactions: true })
                                  setConfirmDeleteId(null)
                                }}
                                disabled={isDeleting}
                                className="flex-1 text-2xs px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 transition-colors disabled:opacity-50"
                              >
                                {isDeleting ? 'Removing�' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card className="mt-4">
            {(() => {
              const exampleKey = importMode === 'balance_history'
                ? 'balance_history'
                : preset || null
              const example = exampleKey ? FORMAT_EXAMPLES[exampleKey] : null
              return (
                <>
                  {example && (
                    <div className="mb-4 pb-4 border-b border-white/[0.06]">
                      <div className="label mb-1.5">{example.label} — Expected Format</div>
                      <p className="text-2xs text-ink-400 mb-2">{example.note}</p>
                      {example.csv && (
                        <div className="bg-surface-900/70 rounded-lg p-3 overflow-x-auto">
                          <pre className="text-2xs font-mono text-ink-300 whitespace-pre leading-relaxed">
                            {example.csv}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="label mb-3">Tips</div>
                  <div className="space-y-3 text-xs text-ink-300">
                    <p>Re-uploading a file that was already imported is safe — duplicates are automatically detected and skipped.</p>
                    <p>Overlapping date ranges are also handled — each transaction is only imported once.</p>
                    <p>After importing, visit Transactions to categorize any uncategorized entries.</p>
                  </div>
                </>
              )
            })()}
          </Card>
        </div>
      </div>
    </div>
  )
}


