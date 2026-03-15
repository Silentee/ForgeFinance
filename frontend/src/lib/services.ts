import { apiClient, setToken } from './api'
import type {
  Account, AccountCreate, AccountUpdate, NetWorthSummary,
  Institution, InstitutionCreate,
  Transaction, TransactionUpdate, TransactionCreate,
  Category, CategoryCreate,
  Budget, BudgetCreate, BudgetUpdate,
  BudgetVisibleCategories, BudgetVisibleCategoriesUpsert,
  BudgetReport, CashFlowReport, NetWorthHistory, SpendingTrendsReport, MonthlyTotalsReport, EquityHistoryReport,
  DailySpendingData,
  ImportSource, CSVImportResult, CSVColumnMapping,
  BalanceSnapshot, BalanceSnapshotUpdate,
} from '@/types'

// ─── Institutions ─────────────────────────────────────────────────────────────

export const institutionsApi = {
  list: () => apiClient.get<Institution[]>('/institutions').then(r => r.data),
  get:  (id: number) => apiClient.get<Institution>(`/institutions/${id}`).then(r => r.data),
  create: (data: InstitutionCreate) => apiClient.post<Institution>('/institutions', data).then(r => r.data),
  update: (id: number, data: Partial<InstitutionCreate>) => apiClient.patch<Institution>(`/institutions/${id}`, data).then(r => r.data),
  delete: (id: number) => apiClient.delete(`/institutions/${id}`),
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accountsApi = {
  list: (params?: { active_only?: boolean; account_type?: string }) =>
    apiClient.get<Account[]>('/accounts', { params }).then(r => r.data),

  get: (id: number) =>
    apiClient.get<Account>(`/accounts/${id}`).then(r => r.data),

  create: (data: AccountCreate) =>
    apiClient.post<Account>('/accounts', data).then(r => r.data),

  update: (id: number, data: AccountUpdate) =>
    apiClient.patch<Account>(`/accounts/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/accounts/${id}`),

  updateBalance: (id: number, balance: number, snapshotDate?: string, notes?: string) =>
    apiClient.post<Account>(`/accounts/${id}/balance`, null, {
      params: { balance, snapshot_date: snapshotDate, notes },
    }).then(r => r.data),

  getBalanceHistory: (id: number, limit?: number) =>
    apiClient.get<{ id: number; date: string; balance: number; balance_type: string }[]>(
      `/accounts/${id}/balance-history`,
      { params: { limit } },
    ).then(r => r.data),

  getNetWorth: () =>
    apiClient.get<NetWorthSummary>('/accounts/net-worth').then(r => r.data),

  importBalanceCsv: (
    accountId: number,
    file: File,
    dateColumn: string,
    balanceColumn: string,
    dateFormat: string,
    skipRows: number,
  ) => {
    const form = new FormData()
    form.append('file', file)
    form.append('date_column', dateColumn)
    form.append('balance_column', balanceColumn)
    form.append('date_format', dateFormat)
    form.append('skip_rows', String(skipRows))
    return apiClient.post<{ imported: number; errors: string[] }>(
      `/accounts/${accountId}/balance-history/import-csv`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then(r => r.data)
  },
}

// ─── Balances ──────────────────────────────────────────────────────────────────

export const balancesApi = {
  list: (params?: { account_id?: number; date_from?: string; date_to?: string; limit?: number }) =>
    apiClient.get<BalanceSnapshot[]>('/balances', { params }).then(r => r.data),

  update: (id: number, data: BalanceSnapshotUpdate) =>
    apiClient.patch<BalanceSnapshot>(`/balances/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/balances/${id}`),
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface TransactionFilters {
  account_id?: number
  category_id?: number
  uncategorized?: boolean
  date_from?: string
  date_to?: string
  transaction_type?: 'debit' | 'credit'
  is_transfer?: boolean
  exclude_from_budget?: boolean
  is_pending?: boolean
  is_annualized?: boolean
  search?: string
  min_amount?: number
  max_amount?: number
  limit?: number
  offset?: number
}

export const transactionsApi = {
  list: (filters?: TransactionFilters) =>
    apiClient.get<Transaction[]>('/transactions', { params: filters }).then(r => r.data),

  get: (id: number) =>
    apiClient.get<Transaction>(`/transactions/${id}`).then(r => r.data),

  create: (data: TransactionCreate) =>
    apiClient.post<Transaction>('/transactions', data).then(r => r.data),

  update: (id: number, data: TransactionUpdate) =>
    apiClient.patch<Transaction>(`/transactions/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/transactions/${id}`),

  summaryByCategory: (params?: { date_from?: string; date_to?: string; account_id?: number }) =>
    apiClient.get<{ category_name: string; category_id?: number; total_debits: number; total_credits: number; net: number; transaction_count: number }[]>(
      '/transactions/summary/by-category', { params }
    ).then(r => r.data),
}

// ─── Categories ───────────────────────────────────────────────────────────────

export const categoriesApi = {
  list: (params?: { flat?: boolean; income_only?: boolean; expense_only?: boolean }) =>
    apiClient.get<Category[]>('/categories', { params }).then(r => r.data),

  create: (data: CategoryCreate) =>
    apiClient.post<Category>('/categories', data).then(r => r.data),

  update: (id: number, data: Partial<CategoryCreate>) =>
    apiClient.patch<Category>(`/categories/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/categories/${id}`),
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export const budgetsApi = {
  list: (params?: { year?: number; month?: number }) =>
    apiClient.get<Budget[]>('/budgets', { params }).then(r => r.data),

  getVisibleCategories: (year: number, month: number) =>
    apiClient.get<BudgetVisibleCategories>('/budgets/visible-categories', { params: { year, month } }).then(r => r.data),

  setVisibleCategories: (data: BudgetVisibleCategoriesUpsert) =>
    apiClient.put<BudgetVisibleCategories>('/budgets/visible-categories', data).then(r => r.data),

  create: (data: BudgetCreate) =>
    apiClient.post<Budget>('/budgets', data).then(r => r.data),

  createBulk: (data: BudgetCreate[]) =>
    apiClient.post<Budget[]>('/budgets/bulk', data).then(r => r.data),

  update: (id: number, data: BudgetUpdate) =>
    apiClient.patch<Budget>(`/budgets/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/budgets/${id}`),

  copyMonth: (params: { from_year: number; from_month: number; to_year: number; to_month: number; overwrite?: boolean }) =>
    apiClient.post<Budget[]>('/budgets/copy-month', null, { params }).then(r => r.data),
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export const reportsApi = {
  budget: (year: number, month: number, accountIds?: number[]) =>
    apiClient.get<BudgetReport>(`/reports/budget/${year}/${month}`, {
      params: accountIds?.length ? { account_ids: accountIds.join(',') } : undefined,
    }).then(r => r.data),

  cashFlow: (year: number, month: number, accountIds?: number[]) =>
    apiClient.get<CashFlowReport>(`/reports/cash-flow/${year}/${month}`, {
      params: accountIds?.length ? { account_ids: accountIds.join(',') } : undefined,
    }).then(r => r.data),

  netWorthHistory: (months?: number) =>
    apiClient.get<NetWorthHistory>('/reports/net-worth/history', { params: { months } }).then(r => r.data),

  spendingTrends: (params?: { months?: number; year?: number; month?: number; top_n?: number; account_ids?: string }) =>
    apiClient.get<SpendingTrendsReport>('/reports/spending-trends', { params }).then(r => r.data),

  monthlyTotals: (params?: { months?: number; year?: number; month?: number }) =>
    apiClient.get<MonthlyTotalsReport>('/reports/monthly-totals', { params }).then(r => r.data),

  equityHistory: (months?: number) =>
    apiClient.get<EquityHistoryReport>('/reports/equity/history', { params: { months } }).then(r => r.data),

  currentMonthSummary: () =>
    apiClient.get<{ cash_flow: CashFlowReport; budget: BudgetReport }>('/reports/summary/current-month').then(r => r.data),

  dailySpending: (year: number, month: number, compareMonths: number) =>
    apiClient.get<DailySpendingData>('/reports/daily-spending', {
      params: { year, month, compare_months: compareMonths },
    }).then(r => r.data),
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

export const importsApi = {
  list: (accountId?: number) =>
    apiClient.get<ImportSource[]>('/imports', { params: { account_id: accountId } }).then(r => r.data),

  uploadCsv: (accountId: number, file: File, preset?: string, columnMapping?: CSVColumnMapping) => {
    const form = new FormData()
    form.append('account_id', String(accountId))
    form.append('file', file)
    if (preset) form.append('preset', preset)
    if (columnMapping) form.append('column_mapping', JSON.stringify(columnMapping))
    return apiClient.post<CSVImportResult>('/imports/csv', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  getPresets: () =>
    apiClient.get<Record<string, CSVColumnMapping>>('/imports/presets').then(r => r.data),

  delete: (id: number, deleteTransactions?: boolean) =>
    apiClient.delete(`/imports/${id}`, { params: { delete_transactions: deleteTransactions } }),
}

// ─── Export ──────────────────────────────────────────────────────────────────

function _downloadCsv(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const exportApi = {
  transactions: () =>
    apiClient.get('/export/transactions', { responseType: 'blob' })
      .then(r => _downloadCsv(r.data, `transactions_${new Date().toISOString().slice(0, 10)}.csv`)),

  balances: () =>
    apiClient.get('/export/balances', { responseType: 'blob' })
      .then(r => _downloadCsv(r.data, `balance_history_${new Date().toISOString().slice(0, 10)}.csv`)),
}

// ─── Demo ────────────────────────────────────────────────────────────────────

export interface DemoStatus {
  has_demo_data: boolean
  demo_account_count: number
  has_real_data: boolean
}

export const demoApi = {
  getStatus: () =>
    apiClient.get<DemoStatus>('/demo/status').then(r => r.data),

  clear: () =>
    apiClient.delete('/demo/clear'),

  seed: () =>
    apiClient.post('/demo/seed'),
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string
  user: { id: number; username: string }
}

export interface AuthStatusResponse {
  setup_required: boolean
}

export const authApi = {
  status: () =>
    apiClient.get<AuthStatusResponse>('/auth/status').then(r => r.data),

  setup: (username: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/setup', { username, password }).then(r => {
      setToken(r.data.access_token)
      return r.data
    }),

  login: (username: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/login', { username, password }).then(r => {
      setToken(r.data.access_token)
      return r.data
    }),

  me: () =>
    apiClient.get<{ id: number; username: string }>('/auth/me').then(r => r.data),

  changePassword: (current_password: string, new_password: string) =>
    apiClient.put<{ message: string }>('/auth/password', { current_password, new_password }).then(r => r.data),
}
