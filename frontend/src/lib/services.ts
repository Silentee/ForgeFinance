import { apiClient, setToken } from './api'
import { todayLocal } from './format'
import type {
  Account, AccountCreate, AccountUpdate, NetWorthSummary,
  AccountTypeDef, AccountTypeCreate, AccountTypeUpdate,
  Institution, InstitutionCreate,
  Transaction, TransactionUpdate, TransactionCreate,
  Category, CategoryCreate, CategoryUpdate,
  Budget, BudgetCreate, BudgetUpdate,
  BudgetVisibleCategories, BudgetVisibleCategoriesUpsert,
  BudgetReport, NetWorthHistory, SpendingTrendsReport, SpendingAveragesReport, MonthlyTotalsReport, EquityHistoryReport,
  SubscriptionsReport, SubscriptionRule, SubscriptionRuleUpsert,
  SubscriptionNicknameUpsert, SubscriptionLinkRequest, SubscriptionUnlinkRequest,
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
    apiClient.post<Account>(`/accounts/${id}/balance`, {
      balance, snapshot_date: snapshotDate, notes,
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
    return apiClient.post<{ imported: number; skipped: number; errors: string[] }>(
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
  account_ids?: string       // comma-separated; server-side multi-select
  category_id?: number
  category_ids?: string       // comma-separated; server-side multi-select
  uncategorized?: boolean
  tags?: string               // comma-separated: is_transfer,exclude_from_budget,is_annualized,is_pending
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
}

// ─── Categories ───────────────────────────────────────────────────────────────

export const categoriesApi = {
  list: (params?: { flat?: boolean; income_only?: boolean; expense_only?: boolean; include_hidden?: boolean }) =>
    apiClient.get<Category[]>('/categories', { params }).then(r => r.data),

  create: (data: CategoryCreate) =>
    apiClient.post<Category>('/categories', data).then(r => r.data),

  update: (id: number, data: CategoryUpdate) =>
    apiClient.patch<Category>(`/categories/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/categories/${id}`),
}

// ─── Account Types ────────────────────────────────────────────────────────────

export const accountTypesApi = {
  list: (params?: { include_hidden?: boolean }) =>
    apiClient.get<AccountTypeDef[]>('/account-types', { params }).then(r => r.data),

  create: (data: AccountTypeCreate) =>
    apiClient.post<AccountTypeDef>('/account-types', data).then(r => r.data),

  update: (id: number, data: AccountTypeUpdate) =>
    apiClient.patch<AccountTypeDef>(`/account-types/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    apiClient.delete(`/account-types/${id}`),
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

  netWorthHistory: (months?: number) =>
    apiClient.get<NetWorthHistory>('/reports/net-worth/history', { params: { months } }).then(r => r.data),

  spendingTrends: (params?: { months?: number; year?: number; month?: number; top_n?: number; account_ids?: string }) =>
    apiClient.get<SpendingTrendsReport>('/reports/spending-trends', { params }).then(r => r.data),

  spendingAverages: (year: number, month: number, accountIds?: number[]) =>
    apiClient.get<SpendingAveragesReport>(`/reports/spending-averages/${year}/${month}`, {
      params: accountIds?.length ? { account_ids: accountIds.join(',') } : undefined,
    }).then(r => r.data),

  monthlyTotals: (params?: { months?: number; year?: number; month?: number }) =>
    apiClient.get<MonthlyTotalsReport>('/reports/monthly-totals', { params }).then(r => r.data),

  equityHistory: (months?: number) =>
    apiClient.get<EquityHistoryReport>('/reports/equity/history', { params: { months } }).then(r => r.data),

  subscriptions: (params?: { months?: number; account_ids?: string; tagged_only?: boolean }) =>
    apiClient.get<SubscriptionsReport>('/reports/subscriptions', { params }).then(r => r.data),
}

// ─── Subscription rules ───────────────────────────────────────────────────────

export const subscriptionsApi = {
  listRules: () =>
    apiClient.get<SubscriptionRule[]>('/subscriptions/rules').then(r => r.data),

  upsertRule: (data: SubscriptionRuleUpsert) =>
    apiClient.put<SubscriptionRule>('/subscriptions/rules', data).then(r => r.data),

  deleteRule: (id: number) =>
    apiClient.delete(`/subscriptions/rules/${id}`),

  setNickname: (data: SubscriptionNicknameUpsert) =>
    apiClient.put('/subscriptions/nickname', data),

  link: (data: SubscriptionLinkRequest) =>
    apiClient.post('/subscriptions/link', data),

  unlink: (data: SubscriptionUnlinkRequest) =>
    apiClient.post('/subscriptions/unlink', data),
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
      .then(r => _downloadCsv(r.data, `transactions_${todayLocal()}.csv`)),

  balances: () =>
    apiClient.get('/export/balances', { responseType: 'blob' })
      .then(r => _downloadCsv(r.data, `balance_history_${todayLocal()}.csv`)),
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
