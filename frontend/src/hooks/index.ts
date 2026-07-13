import { useEffect, useMemo, useState } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi, accountTypesApi, balancesApi, transactionsApi, categoriesApi, budgetsApi, reportsApi, subscriptionsApi, importsApi, institutionsApi, demoApi, authApi, type TransactionFilters } from '@/lib/services'
import { getToken } from '@/lib/api'
import type { AccountCreate, AccountUpdate, AccountTypeCreate, AccountTypeUpdate, AccountTypeDef, BudgetCreate, BudgetUpdate, TransactionUpdate, TransactionCreate, CategoryCreate, CategoryUpdate, CSVColumnMapping, BalanceSnapshotUpdate, SubscriptionRuleUpsert, SubscriptionNicknameUpsert, SubscriptionLinkRequest, SubscriptionUnlinkRequest, SubscriptionCadenceUpsert, ManualSubscriptionCreate } from '@/types'
import { formatAccountType } from '@/lib/format'
import toast from 'react-hot-toast'

// Debounce a rapidly-changing value (e.g. a search box) so it only drives a
// query after the user pauses typing.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

// ─── Query key factory (centralised, avoids magic strings) ───────────────────

export const QK = {
  institutions:  () => ['institutions'] as const,
  accounts:      (params?: object) => ['accounts', params] as const,
  account:       (id: number) => ['accounts', id] as const,
  netWorth:      () => ['accounts', 'net-worth'] as const,
  balanceHistory:(id: number, limit?: number) => ['accounts', id, 'balance-history', limit] as const,
  transactions:  (filters?: object) => ['transactions', filters] as const,
  categories:    (params?: object) => ['categories', params] as const,
  accountTypes:  (params?: object) => ['account-types', params] as const,
  budgets:       (params?: object) => ['budgets', params] as const,
  budgetVisibleCategories: (year: number, month: number) => ['budgets', 'visible-categories', year, month] as const,
  reportBudget:  (year: number, month: number) => ['reports', 'budget', year, month] as const,
  reportNetWorth:(months?: number) => ['reports', 'net-worth', months] as const,
  reportTrends:  (params?: object) => ['reports', 'trends', params] as const,
  reportSpendingAverages: (year: number, month: number) => ['reports', 'spending-averages', year, month] as const,
  reportMonthlyTotals: (params?: object) => ['reports', 'monthly-totals', params] as const,
  reportSubscriptions: (params?: object) => ['reports', 'subscriptions', params] as const,
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
    queryKey: QK.balanceHistory(accountId, limit),
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
      qc.invalidateQueries({ queryKey: ['accounts', accountId, 'balance-history'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
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
      qc.invalidateQueries({ queryKey: ['accounts', accountId, 'balance-history'] })
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
      qc.invalidateQueries({ queryKey: ['accounts', accountId, 'balance-history'] })
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
      // Deleting an account cascades its transactions and balance history.
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Account deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function useTransactions(filters?: TransactionFilters) {
  const { offset: _offset, ...baseFilters } = filters ?? {}
  const limit = baseFilters.limit ?? 500

  return useInfiniteQuery({
    queryKey: QK.transactions(baseFilters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => transactionsApi.list({ ...baseFilters, limit, offset: pageParam }),
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.length < limit ? undefined : (lastPageParam + limit),
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

export function useCategories(params?: { flat?: boolean; income_only?: boolean; expense_only?: boolean; include_hidden?: boolean }) {
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

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CategoryUpdate }) => categoriesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => categoriesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Category deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ─── Account Types ────────────────────────────────────────────────────────────

export function useAccountTypes(params?: { include_hidden?: boolean }) {
  return useQuery({ queryKey: QK.accountTypes(params), queryFn: () => accountTypesApi.list(params) })
}

/**
 * Convenience view over the (non-hidden) account types for building selects,
 * grouping and labels across the app. Falls back to the static label map while
 * types are loading so nothing renders blank.
 */
export function useAccountTypeMap() {
  const { data: types } = useAccountTypes()
  return useMemo(() => {
    const ordered = [...(types ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    const byKey = new Map(ordered.map(t => [t.key, t]))
    return {
      ordered,
      byKey,
      assets: ordered.filter(t => !t.is_liability),
      liabilities: ordered.filter(t => t.is_liability),
      label: (key: string) => byKey.get(key)?.label ?? formatAccountType(key),
      isLiability: (key: string) => byKey.get(key)?.is_liability ?? false,
    }
  }, [types])
}

export function useCreateAccountType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountTypeCreate) => accountTypesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-types'] })
      toast.success('Account type created')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateAccountType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountTypeUpdate }) => accountTypesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-types'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteAccountType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => accountTypesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-types'] })
      toast.success('Account type deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// Re-export for convenience so components can import the type from hooks.
export type { AccountTypeDef }

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

// Quiet sibling of useBulkCreateBudgets for per-field auto-save on blur —
// same mutation + invalidation, but no toast (the page shows an inline "saved" tick).
export function useAutoSaveBudgets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: BudgetCreate[]) => budgetsApi.createBulk(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
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

export function useSpendingAverages(year: number, month: number) {
  return useQuery({
    queryKey: QK.reportSpendingAverages(year, month),
    queryFn: () => reportsApi.spendingAverages(year, month),
    enabled: !!year && !!month,
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

// ─── Subscriptions ────────────────────────────────────────────────────────────

export function useSubscriptionsReport(params?: { months?: number; tagged_only?: boolean }) {
  return useQuery({
    queryKey: QK.reportSubscriptions(params),
    queryFn: () => reportsApi.subscriptions(params),
  })
}

export function useUpsertSubscriptionRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubscriptionRuleUpsert) => subscriptionsApi.upsertRule(data),
    onSuccess: (_, { rule }) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(rule === 'exclude' ? 'Subscription dismissed' : 'Subscription tracked')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteSubscriptionRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => subscriptionsApi.deleteRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Subscription override removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSetSubscriptionNickname() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubscriptionNicknameUpsert) => subscriptionsApi.setNickname(data),
    onSuccess: (_, { nickname }) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(nickname ? 'Nickname saved' : 'Nickname cleared')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSetSubscriptionCadence() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubscriptionCadenceUpsert) => subscriptionsApi.setCadence(data),
    onSuccess: (_, { cadence }) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(cadence ? 'Cadence updated' : 'Cadence reset to auto')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateManualSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ManualSubscriptionCreate) => subscriptionsApi.createManual(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Subscription added')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useResolveMerchantKeys(transactionIds: number[]) {
  return useQuery({
    queryKey: ['subscriptions', 'resolve-keys', [...transactionIds].sort((a, b) => a - b)],
    queryFn: () => subscriptionsApi.resolveKeys(transactionIds),
    enabled: transactionIds.length > 0,
  })
}

export function useLinkSubscriptions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubscriptionLinkRequest) => subscriptionsApi.link(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Subscriptions linked')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUnlinkSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SubscriptionUnlinkRequest) => subscriptionsApi.unlink(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success('Subscription unlinked')
    },
    onError: (e: Error) => toast.error(e.message),
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
      qc.invalidateQueries({ queryKey: ['accounts', accountId, 'balance-history'] })
      qc.invalidateQueries({ queryKey: ['reports'] })
      toast.success(
        `Imported ${result.imported} balance entries` +
        (result.skipped > 0 ? ` (${result.skipped} duplicates skipped)` : '')
      )
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
