import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi, balancesApi, transactionsApi, categoriesApi, budgetsApi, reportsApi, importsApi, institutionsApi, demoApi, authApi, type TransactionFilters } from '@/lib/services'
import { getToken } from '@/lib/api'
import type { AccountCreate, AccountUpdate, BudgetCreate, BudgetUpdate, TransactionUpdate, TransactionCreate, CategoryCreate, CSVColumnMapping, BalanceSnapshotUpdate } from '@/types'
import toast from 'react-hot-toast'

// ─── Query key factory (centralised, avoids magic strings) ───────────────────

export const QK = {
  institutions:  () => ['institutions'] as const,
  accounts:      (params?: object) => ['accounts', params] as const,
  account:       (id: number) => ['accounts', id] as const,
  netWorth:      () => ['accounts', 'net-worth'] as const,
  balanceHistory:(id: number) => ['accounts', id, 'balance-history'] as const,
  transactions:  (filters?: object) => ['transactions', filters] as const,
  categories:    (params?: object) => ['categories', params] as const,
  budgets:       (params?: object) => ['budgets', params] as const,
  budgetVisibleCategories: (year: number, month: number) => ['budgets', 'visible-categories', year, month] as const,
  reportBudget:  (year: number, month: number) => ['reports', 'budget', year, month] as const,
  reportCashFlow:(year: number, month: number) => ['reports', 'cash-flow', year, month] as const,
  reportNetWorth:(months?: number) => ['reports', 'net-worth', months] as const,
  reportTrends:  (params?: object) => ['reports', 'trends', params] as const,
  reportMonthlyTotals: (params?: object) => ['reports', 'monthly-totals', params] as const,
  reportSummary: () => ['reports', 'summary'] as const,
  imports:       (accountId?: number) => ['imports', accountId] as const,
}

// ─── Institutions ─────────────────────────────────────────────────────────────

export function useInstitutions() {
  return useQuery({ queryKey: QK.institutions(), queryFn: institutionsApi.list })
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export function useAccounts(params?: { active_only?: boolean; account_type?: string }) {
  return useQuery({ queryKey: QK.accounts(params), queryFn: () => accountsApi.list(params) })
}

export function useAccount(id: number) {
  return useQuery({ queryKey: QK.account(id), queryFn: () => accountsApi.get(id), enabled: !!id })
}

export function useNetWorth() {
  return useQuery({ queryKey: QK.netWorth(), queryFn: accountsApi.getNetWorth })
}

export function useBalanceHistory(accountId: number, limit?: number) {
  return useQuery({
    queryKey: QK.balanceHistory(accountId),
    queryFn: () => accountsApi.getBalanceHistory(accountId, limit),
    enabled: !!accountId,
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountCreate) => accountsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      toast.success('Account created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateAccount(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountUpdate) => accountsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      toast.success('Account updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateBalance(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ balance, date, notes }: { balance: number; date?: string; notes?: string }) =>
      accountsApi.updateBalance(accountId, balance, date, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: QK.balanceHistory(accountId) })
      toast.success('Balance updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateBalanceSnapshot(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ snapshotId, data }: { snapshotId: number; data: BalanceSnapshotUpdate }) =>
      balancesApi.update(snapshotId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: QK.balanceHistory(accountId) })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Balance entry updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteBalanceSnapshot(accountId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshotId: number) => balancesApi.delete(snapshotId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: QK.balanceHistory(accountId) })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Balance entry deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => accountsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      toast.success('Account deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useTransactions(filters?: TransactionFilters) {
  return useQuery({
    queryKey: QK.transactions(filters),
    queryFn: () => transactionsApi.list(filters),
  })
}

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TransactionCreate) => transactionsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Transaction added')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateTransaction(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TransactionUpdate) => transactionsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Transaction updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => transactionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Transaction deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Categories ───────────────────────────────────────────────────────────────

export function useCategories(params?: { flat?: boolean; income_only?: boolean; expense_only?: boolean }) {
  return useQuery({ queryKey: QK.categories(params), queryFn: () => categoriesApi.list(params) })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CategoryCreate) => categoriesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Category created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export function useBudgets(params?: { year?: number; month?: number }) {
  return useQuery({ queryKey: QK.budgets(params), queryFn: () => budgetsApi.list(params) })
}

export function useBudgetVisibleCategories(year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: QK.budgetVisibleCategories(year, month),
    queryFn: () => budgetsApi.getVisibleCategories(year, month),
    enabled: enabled && !!year && !!month && !!getToken(),
  })
}

export function useSetBudgetVisibleCategories() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { year: number; month: number; category_ids: number[] }) =>
      budgetsApi.setVisibleCategories(data),
    onSuccess: (data) => {
      qc.setQueryData(QK.budgetVisibleCategories(data.year, data.month), data)
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateBudget() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BudgetCreate) => budgetsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Budget saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateBudget(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BudgetUpdate) => budgetsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Budget updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useBulkCreateBudgets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BudgetCreate[]) => budgetsApi.createBulk(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Budgets saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCopyBudgetMonth() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { from_year: number; from_month: number; to_year: number; to_month: number; overwrite?: boolean }) =>
      budgetsApi.copyMonth(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}


// ─── Reports ──────────────────────────────────────────────────────────────────

export function useBudgetReport(year: number, month: number) {
  return useQuery({
    queryKey: QK.reportBudget(year, month),
    queryFn: () => reportsApi.budget(year, month),
    enabled: !!year && !!month,
  })
}

export function useCashFlowReport(year: number, month: number) {
  return useQuery({
    queryKey: QK.reportCashFlow(year, month),
    queryFn: () => reportsApi.cashFlow(year, month),
    enabled: !!year && !!month,
  })
}

export function useNetWorthHistory(months = 24) {
  return useQuery({
    queryKey: QK.reportNetWorth(months),
    queryFn: () => reportsApi.netWorthHistory(months),
  })
}

export function useSpendingTrends(params?: { months?: number; year?: number; month?: number; top_n?: number }) {
  return useQuery({
    queryKey: QK.reportTrends(params),
    queryFn: () => reportsApi.spendingTrends(params),
  })
}

export function useMonthlyTotals(params?: { months?: number; year?: number; month?: number }) {
  return useQuery({
    queryKey: QK.reportMonthlyTotals(params),
    queryFn: () => reportsApi.monthlyTotals(params),
  })
}

export function useEquityHistory(months = 24) {
  return useQuery({
    queryKey: ['reports', 'equity', months],
    queryFn: () => reportsApi.equityHistory(months),
  })
}

export function useCurrentMonthSummary() {
  return useQuery({
    queryKey: QK.reportSummary(),
    queryFn: reportsApi.currentMonthSummary,
  })
}

export function useDailySpending(year: number, month: number, compareMonths: number) {
  return useQuery({
    queryKey: ['reports', 'daily-spending', year, month, compareMonths],
    queryFn: () => reportsApi.dailySpending(year, month, compareMonths),
  })
}

// ─── Imports ──────────────────────────────────────────────────────────────────

export function useImports(accountId?: number) {
  return useQuery({
    queryKey: QK.imports(accountId),
    queryFn: () => importsApi.list(accountId),
  })
}

export function useDeleteImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteTransactions }: { id: number; deleteTransactions: boolean }) =>
      importsApi.delete(id, deleteTransactions),
    onSuccess: (_, { deleteTransactions }) => {
      qc.invalidateQueries({ queryKey: ['imports'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(deleteTransactions ? 'Import and transactions removed' : 'Import record removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useImportBalanceCsv() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, file, dateColumn, balanceColumn, dateFormat, skipRows }: {
      accountId: number
      file: File
      dateColumn: string
      balanceColumn: string
      dateFormat: string
      skipRows: number
    }) => accountsApi.importBalanceCsv(accountId, file, dateColumn, balanceColumn, dateFormat, skipRows),
    onSuccess: (result, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: QK.balanceHistory(accountId) })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(`Imported ${result.imported} balance entries`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUploadCsv() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, file, preset, mapping }: {
      accountId: number
      file: File
      preset?: string
      mapping?: CSVColumnMapping
    }) => importsApi.uploadCsv(accountId, file, preset, mapping),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['imports'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(
        `Imported ${result.transactions_imported} transactions` +
        (result.transactions_skipped > 0 ? ` (${result.transactions_skipped} duplicates skipped)` : '')
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Demo ────────────────────────────────────────────────────────────────────

export function useDemoStatus() {
  return useQuery({
    queryKey: ['demo', 'status'],
    queryFn: demoApi.getStatus,
  })
}

export function useClearDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => demoApi.clear(),
    onSuccess: () => {
      qc.invalidateQueries()
      Object.keys(localStorage)
        .filter(k => k === 'forge-budget-visible-categories' || k.startsWith('forge-budget-visible-categories-'))
        .forEach(k => localStorage.removeItem(k))
      toast.success('Demo data cleared')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useStartDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => demoApi.seed(),
    onSuccess: () => {
      qc.invalidateQueries()
      toast.success('Demo data loaded')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth', 'status'],
    queryFn: authApi.status,
  })
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    enabled: !!getToken(),
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.login(username, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      authApi.setup(username, password),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => toast.success('Password updated'),
    onError: (e: Error) => toast.error(e.message),
  })
}
