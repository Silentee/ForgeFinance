import enum


class AccountType(str, enum.Enum):
    """
    Broad classification of an account.
    Determines how balances and transactions are interpreted.
    """
    # Asset accounts (positive balance = you own this)
    CHECKING = "checking"
    SAVINGS = "savings"
    HYSA = "hysa"
    CASH = "cash"
    PRECIOUS_METAL = "precious_metal"
    INVESTMENT = "investment"
    RETIREMENT = "retirement"
    HSA = "hsa"
    REAL_ESTATE = "real_estate"
    VEHICLE = "vehicle"
    OTHER_ASSET = "other_asset"
    # Liability accounts (positive balance = you owe this)
    CREDIT_CARD = "credit_card"
    MORTGAGE = "mortgage"
    CAR_LOAN = "car_loan"
    STUDENT_LOAN = "student_loan"
    PERSONAL_LOAN = "personal_loan"
    OTHER_LIABILITY = "other_liability"


class AccountSubtype(str, enum.Enum):
    """
    Optional finer-grained classification within an AccountType.
    Mirrors Plaid's subtype taxonomy for future compatibility.
    """
    # Depository
    CHECKING = "checking"
    SAVINGS = "savings"
    MONEY_MARKET = "money_market"
    CD = "cd"
    # Credit
    CREDIT_CARD = "credit_card"
    # Investment
    BROKERAGE = "brokerage"
    IRA = "ira"
    ROTH_IRA = "roth_ira"
    K401 = "401k"
    K403B = "403b"
    HSA = "hsa"
    # Loans / Liabilities
    MORTGAGE = "mortgage"
    AUTO_LOAN = "auto_loan"
    STUDENT_LOAN = "student_loan"
    HOME_EQUITY = "home_equity"
    # Real assets
    REAL_ESTATE = "real_estate"
    VEHICLE = "vehicle"
    # Other
    OTHER = "other"


class TransactionType(str, enum.Enum):
    DEBIT = "debit"    # Money leaving the account (expense, payment)
    CREDIT = "credit"  # Money entering the account (income, refund)


class ImportSourceType(str, enum.Enum):
    """
    Where did this data come from?
    Adding PLAID here later is all that's needed to support it.
    """
    CSV = "csv"
    MANUAL = "manual"
    PLAID = "plaid"   # Reserved for future use


class BalanceType(str, enum.Enum):
    """
    Snapshot vs. computed balance.
    Investment and real-estate accounts are snapshot-based.
    Checking/credit accounts can be computed from transactions but
    we also store periodic snapshots for reconciliation.
    """
    SNAPSHOT = "snapshot"   # Manually entered or imported point-in-time value
    COMPUTED = "computed"   # Derived from transaction history
