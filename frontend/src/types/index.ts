// ─── Enums ────────────────────────────────────────────────────────────────────

export type AccountType =
  | 'checking' | 'savings' | 'hysa' | 'cash' | 'precious_metal' | 'investment' | 'retirement' | 'hsa' | 'real_estate' | 'vehicle' | 'other_asset'
  | 'credit_card' | 'mortgage' | 'car_loan' | 'student_loan' | 'personal_loan' | 'other_liability'

export type AccountSubtype =
  | 'checking' | 'savings' | 'money_market' | 'cd'
  | 'credit_card'
  | 'brokerage' | 'ira' | 'roth_ira' | '401k' | '403b' | 'hsa'
  | 'mortgage' | 'auto_loan' | 'student_loan' | 'home_equity'
  | 'real_estate' | 'vehicle' | 'other'

export type TransactionType = 'debit' | 'credit'

export type ImportSourceType = 'csv' | 'manual' | 'plaid'

// ─── Institutions ─────────────────────────────────────────────────────────────

export interface Institution {
  id: number
  name: string
  url?: string
  notes?: string
  plaid_institution_id?: string
  created_at: string
  updated_at: string
}

export interface InstitutionCreate {
  name: string
  url?: string
  notes?: string
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export interface LinkedAccountInfo {
  id: number
  name: string
  account_type: AccountType
  current_balance?: number
}

export interface Account {
  id: number
  name: string
  account_type: AccountType
  account_subtype?: AccountSubtype
  institution_id?: number
  institution?: Institution
  mask?: string
  currency: string
  current_balance?: number
  balance_updated_at?: string
  is_active: boolean
  include_in_net_worth: boolean
  is_liability: boolean
  is_liquid: boolean
  net_worth_value: number
  notes?: string
  default_csv_preset?: string
  linked_liability_id?: number
  linked_liability?: LinkedAccountInfo
  linked_assets?: LinkedAccountInfo[]
  created_at: string
  updated_at: string
}

export interface AccountCreate {
  name: string
  account_type: AccountType
  account_subtype?: AccountSubtype
  institution_id?: number
  mask?: string
  currency?: string
  is_active?: boolean
  include_in_net_worth?: boolean
  is_liquid?: boolean
  notes?: string
  initial_balance?: number
  default_csv_preset?: string
  linked_liability_id?: number
}

export interface AccountUpdate {
  name?: string
  account_type?: AccountType
  account_subtype?: AccountSubtype
  institution_id?: number
  mask?: string
  is_active?: boolean
  include_in_net_worth?: boolean
  is_liquid?: boolean
  notes?: string
  default_csv_preset?: string | null
  linked_liability_id?: number | null
}

export interface NetWorthSummary {
  total_assets: number
  total_liabilities: number
  net_worth: number
  accounts_by_type: Record<string, number>
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: number
  account_id: number
  account_name?: string
  category_id?: number
  category_name?: string
  import_source_id?: number
  date: string
  amount: number
  signed_amount: number
  transaction_type: TransactionType
  original_description: string
  description?: string
  merchant_name?: string
  is_pending: boolean
  is_transfer: boolean
  exclude_from_budget: boolean
  is_annualized: boolean
  notes?: string
  created_at: string
  updated_at: string
}

export interface TransactionUpdate {
  date?: string
  amount?: number
  transaction_type?: TransactionType
  category_id?: number | null
  description?: string
  is_transfer?: boolean
  exclude_from_budget?: boolean
  is_annualized?: boolean
  notes?: string | null
}

export interface TransactionCreate {
  account_id: number
  date: string
  amount: number
  transaction_type: TransactionType
  original_description: string
  description?: string
  category_id?: number
  is_transfer?: boolean
  exclude_from_budget?: boolean
  is_annualized?: boolean
  notes?: string
}

// ─── Categories ───────────────────────────────────────────────────────────────

export interface Category {
  id: number
  name: string
  is_income: boolean
  is_system: boolean
  color?: string
  icon?: string
  parent_id?: number
  notes?: string
  children: Category[]
}

export interface CategoryCreate {
  name: string
  is_income?: boolean
  color?: string
  icon?: string
  parent_id?: number
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

export interface Budget {
  id: number
  category_id: number
  category_name?: string
  month: number
  year: number
  amount: number
  notes?: string
}

export interface BudgetCreate {
  category_id: number
  month: number
  year: number
  amount: number
  notes?: string
}

export interface BudgetUpdate {
  amount?: number
  notes?: string
}

export interface BudgetVisibleCategories {
  year: number
  month: number
  category_ids: number[] | null
  updated_at: string | null
}

export interface BudgetVisibleCategoriesUpsert {
  year: number
  month: number
  category_ids: number[]
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface BudgetLineItem {
  category_id?: number
  category_name: string
  parent_category_name?: string
  is_income: boolean
  budgeted: number
  actual: number
  remaining: number
  percent_used?: number
  transaction_count: number
}

export interface BudgetReport {
  year: number
  month: number
  month_label: string
  total_income_budgeted: number
  total_income_actual: number
  total_expenses_budgeted: number
  total_expenses_actual: number
  net_actual: number
  net_budgeted: number
  income_lines: BudgetLineItem[]
  expense_lines: BudgetLineItem[]
}

export interface CashFlowReport {
  year: number
  month: number
  month_label: string
  total_income: number
  total_expenses: number
  net_cash_flow: number
  savings_rate?: number
  income_by_account_type: Record<string, number>
  expenses_by_account_type: Record<string, number>
  top_expense_categories: { category_name: string; total: number }[]
  largest_transactions: {
    id: number; date: string; amount: number
    transaction_type: TransactionType; description: string
    account_name?: string; category_name?: string
  }[]
}

export interface NetWorthDataPoint {
  date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  by_type: Record<string, number>
}

export interface NetWorthHistory {
  data_points: NetWorthDataPoint[]
  current_net_worth: number
  change_1m?: number
  change_3m?: number
  change_period?: number
}

export interface CategoryTrendSeries {
  category_id?: number
  category_name: string
  is_income: boolean
  monthly_totals: number[]
  average: number
  total: number
}

export interface SpendingTrendsReport {
  months: string[]
  month_labels: string[]
  series: CategoryTrendSeries[]
  monthly_income_totals: number[]
  monthly_expense_totals: number[]
  monthly_net_totals: number[]
}

export interface MonthlyTotalsReport {
  months: string[]
  month_labels: string[]
  monthly_income_totals: number[]
  monthly_expense_totals: number[]
  monthly_net_totals: number[]
}

// ─── Equity History ──────────────────────────────────────────────────────────

export interface EquityDataPoint {
  date: string
  asset_value: number
  liability_balance: number
  equity: number
}

export interface LinkedEquityPair {
  asset_id: number
  asset_name: string
  asset_type: string
  liability_id: number
  liability_name: string
  liability_type: string
  current_equity: number
  equity_change_1m?: number
  equity_change_1y?: number
  data_points: EquityDataPoint[]
}

export interface EquityHistoryReport {
  pairs: LinkedEquityPair[]
  total_linked_equity: number
}

export interface DailySpendingData {
  days: number[]
  current_month: (number | null)[]
  average_month: number[]
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

export interface ImportSource {
  id: number
  account_id: number
  source_type: ImportSourceType
  file_name?: string
  date_range_start?: string
  date_range_end?: string
  transactions_imported: number
  transactions_skipped: number
  is_successful: boolean
  error_message?: string
  imported_at: string
}

export interface CSVImportResult {
  import_source_id?: number
  account_id: number
  file_name: string
  transactions_imported: number
  transactions_skipped: number
  date_range_start?: string
  date_range_end?: string
  errors: string[]
  is_successful: boolean
}

export interface CSVColumnMapping {
  date?: string
  amount?: string
  description?: string
  transaction_type?: string
  merchant?: string
  category?: string
  amount_format?: 'signed' | 'signed_inverted' | 'absolute' | 'split'
  debit_column?: string
  credit_column?: string
  date_format?: string
  skip_rows?: number
  category_map?: Record<string, string>
}

// ─── Balance Snapshots ────────────────────────────────────────────────────────

export interface BalanceSnapshot {
  id: number
  account_id: number
  snapshot_date: string
  balance: number
  notes?: string
  created_at: string
}

export interface BalanceSnapshotUpdate {
  snapshot_date?: string
  balance?: number
  notes?: string
}

