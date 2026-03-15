"""
csv_import.py — CSV parsing and transaction import service.

Design goals:
- Flexible column mapping so it works with any bank's CSV export format
- Robust duplicate detection so re-importing an overlapping date range is safe
- Clean separation between parsing (pure functions) and DB persistence
- Structured enough that swapping in a Plaid data source later just means
  implementing a different "source adapter" that yields the same ParsedTransaction type

Supported CSV formats out of the box:
    - Signed amount (positive=credit, negative=debit): Chase, Citi, most banks
    - Absolute amount + type column: Bank of America, Wells Fargo
    - Split debit/credit columns: some credit unions, Fidelity

To add support for a new bank, you typically just need to provide a different
CSVColumnMapping when calling import_csv_file().
"""

import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

import pandas as pd
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Account, Transaction, ImportSource, Category
from app.models.enums import TransactionType, ImportSourceType
from app.schemas.imports import CSVColumnMapping


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ParsedTransaction:
    """
    Intermediate representation of a transaction parsed from CSV.
    Decoupled from the SQLAlchemy model so parsing is testable without a DB.
    """
    date: date
    amount: float          # always positive
    transaction_type: TransactionType
    original_description: str
    merchant_name: Optional[str] = None
    category_name: Optional[str] = None
    dedup_hash: Optional[str] = None


@dataclass
class ImportResult:
    transactions_imported: int = 0
    transactions_skipped: int = 0   # duplicates
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Known bank presets
# Provide these as a convenience so users don't have to specify mappings
# for the most common institutions. The frontend can present a dropdown.
# ---------------------------------------------------------------------------

_CHASE_CATEGORY_MAP = {
    "Food & Drink":        "Restaurants",
    "Groceries":           "Groceries",
    "Shopping":            "Shopping",
    "Gas":                 "Transportation",
    "Automotive":          "Transportation",
    "Bills & Utilities":   "Subscriptions",
    "Health & Wellness":   "Healthcare",
    "Professional Services": "Other Expense",
    "Home":                "Home Maintenance & Repairs",
    "Travel":              "Travel",
    "Entertainment":       "Entertainment",
    "Education":           "Education",
    "Personal":            "Personal Care",
    "Fees & Adjustments":  "Fees & Interest",
    "ATM":                 "Fees & Interest",
}

BANK_PRESETS: dict[str, CSVColumnMapping] = {
    "chase_checking": CSVColumnMapping(
        date="Transaction Date",
        amount="Amount",
        description="Description",
        amount_format="signed",
        date_format="%m/%d/%Y",
        category="Category",
        category_map=_CHASE_CATEGORY_MAP,
    ),
    "chase_credit": CSVColumnMapping(
        date="Transaction Date",
        amount="Amount",
        description="Description",
        amount_format="signed",
        date_format="%m/%d/%Y",
        category="Category",
        category_map=_CHASE_CATEGORY_MAP,
    ),
    "bank_of_america": CSVColumnMapping(
        date="Date",
        amount="Amount",
        description="Description",
        amount_format="signed",
        date_format="%m/%d/%Y",
        skip_rows=6,
        category_map={
            "Dining":                    "Restaurants",
            "Food & Drink":              "Restaurants",
            "Groceries":                 "Groceries",
            "Gas":                       "Transportation",
            "Gas & Automotive":          "Transportation",
            "Automotive":                "Transportation",
            "Shopping":                  "Shopping",
            "Online Shopping":           "Shopping",
            "Travel":                    "Travel",
            "Entertainment":             "Entertainment",
            "Healthcare":                "Healthcare",
            "Health Care":               "Healthcare",
            "Home & Garden":             "Home Maintenance & Repairs",
            "Home Improvement":          "Home Improvement",
            "Home":                      "Home Maintenance & Repairs",
            "Bills & Utilities":         "Subscriptions",
            "Utilities":                 "Internet & TV",
            "Income":                    "Other Income",
            "Personal Care":             "Personal Care",
            "Education":                 "Education",
            "Fees":                      "Fees & Interest",
        },
    ),
    "wells_fargo": CSVColumnMapping(
        date="Date",
        amount="Amount",
        description="Description",
        amount_format="signed",
        date_format="%m/%d/%Y",
    ),
    "fidelity": CSVColumnMapping(
        date="Date",
        description="Description",
        amount_format="split",
        debit_column="Debit",
        credit_column="Credit",
        date_format="%m/%d/%Y",
        amount="Amount",  # unused in split mode but required by schema
    ),
    "capital_one": CSVColumnMapping(
        date="Transaction Date",
        amount="Debit",
        description="Description",
        merchant="Description",
        amount_format="split",
        debit_column="Debit",
        credit_column="Credit",
        date_format="%Y-%m-%d",
        category="Category",
        category_map={
            "Restaurants":       "Restaurants",
            "Dining":            "Restaurants",
            "Groceries":         "Groceries",
            "Gas":               "Transportation",
            "Gasoline":          "Transportation",
            "Automotive":        "Transportation",
            "Shopping":          "Shopping",
            "Merchandise":       "Shopping",
            "Entertainment":     "Entertainment",
            "Travel":            "Travel",
            "Healthcare":        "Healthcare",
            "Health Care":       "Healthcare",
            "Bills & Utilities": "Subscriptions",
            "Utilities":         "Internet & TV",
            "Income":            "Other Income",
            "Other Income":      "Other Income",
            "Personal":          "Personal Care",
            "Education":         "Education",
            "Home":              "Home Maintenance & Repairs",
            "Misc/Other":        "Other Expense",
            "Fees":              "Fees & Interest",
        },
    ),
    "american_express": CSVColumnMapping(
        date="Date",
        amount="Amount",
        description="Description",
        amount_format="signed_inverted",
        date_format="%m/%d/%Y",
        category="Category",
        category_map={
            # Restaurant
            "Restaurant-Restaurant":                        "Restaurants",
            "Restaurant-Bar & Café":                        "Restaurants",
            "Restaurant-Bar & Cafe":                        "Restaurants",
            # Merchandise & Supplies
            "Merchandise & Supplies-Groceries":             "Groceries",
            "Merchandise & Supplies-Wholesale Stores":      "Groceries",
            "Merchandise & Supplies-Pharmacies":            "Healthcare",
            "Merchandise & Supplies-Clothing Stores":       "Shopping",
            "Merchandise & Supplies-Department Stores":     "Shopping",
            "Merchandise & Supplies-Electronics Stores":    "Shopping",
            "Merchandise & Supplies-General Retail":        "Shopping",
            "Merchandise & Supplies-Internet Purchase":     "Shopping",
            "Merchandise & Supplies-Mail Order":            "Shopping",
            "Merchandise & Supplies-Book Stores":           "Shopping",
            "Merchandise & Supplies-Sporting Goods Stores": "Shopping",
            "Merchandise & Supplies-Hardware Supplies":     "Home Maintenance & Repairs",
            "Merchandise & Supplies-Appliance Stores":      "Home Maintenance & Repairs",
            "Merchandise & Supplies-Furnishing":            "Home Maintenance & Repairs",
            "Merchandise & Supplies-Florists & Garden":     "Home Maintenance & Repairs",
            "Merchandise & Supplies-Computer Supplies":     "Shopping",
            # Transportation
            "Transportation-Fuel":                          "Transportation",
            "Transportation-Auto Services":                 "Transportation",
            "Transportation-Parking Charges":               "Transportation",
            "Transportation-Rail Services":                 "Transportation",
            # Travel
            "Travel-Airline":                               "Travel",
            "Travel-Lodging":                               "Travel",
            "Travel-Travel Agencies":                       "Travel",
            # Entertainment
            "Entertainment-Other Entertainment":            "Entertainment",
            "Entertainment-Associations":                   "Entertainment",
            # Business Services
            "Business Services-Health Care Services":       "Healthcare",
            "Business Services-Mailing & Shipping":         "Other Expense",
            "Business Services-Office Supplies":            "Other Expense",
            "Business Services-Other Services":             "Other Expense",
            # Other
            "Other-Government Services":                    "Other Expense",
            "Fees & Adjustments-Fees & Adjustments":        "Fees & Interest",
        },
    ),
    "schwab_checking": CSVColumnMapping(
        date="Date",
        description="Description",
        amount_format="split",
        debit_column="Withdrawal",
        credit_column="Deposit",
        date_format="%m/%d/%Y",
        amount="Amount",
    ),
    "USAA_checking": CSVColumnMapping(
        date="Date",
        description="Description",
        amount="Amount",
        amount_format="signed",
        date_format="%Y-%m-%d",
        category="Category",
        category_map={
            "Interest Income":   "Investment Income",
            "Paycheck":          "Salary & Wages",
            "Income":            "Other Income",
            "Bills & Utilities": "Subscriptions",
            "Utilities":         "Internet & TV",
            "Groceries":         "Groceries",
            "Dining":            "Restaurants",
            "Food & Drink":      "Restaurants",
            "Shopping":          "Shopping",
            "Gas":               "Transportation",
            "Healthcare":        "Healthcare",
            "Travel":            "Travel",
            "Entertainment":     "Entertainment",
            "Personal Care":     "Personal Care",
            "Atm Fee":           "Fees & Interest",
        },
    ),
    "USAA_credit": CSVColumnMapping(
        date="Date",
        description="Description",
        amount="Amount",
        amount_format="signed_inverted",
        date_format="%Y-%m-%d",
        category="Category",
        category_map={
            "Interest Income":   "Investment Income",
            "Paycheck":          "Salary & Wages",
            "Income":            "Other Income",
            "Bills & Utilities": "Subscriptions",
            "Utilities":         "Internet & TV",
            "Groceries":         "Groceries",
            "Dining":            "Restaurants",
            "Food & Drink":      "Restaurants",
            "Shopping":          "Shopping",
            "Gas":               "Transportation",
            "Healthcare":        "Healthcare",
            "Travel":            "Travel",
            "Entertainment":     "Entertainment",
            "Personal Care":     "Personal Care",
            "Atm Fee":           "Fees & Interest",
            "Television":        "Subscriptions",
        },
    ),
    "pentucket_bank": CSVColumnMapping(
        date="Date",
        description="Description",
        amount_format="split",
        debit_column="Amount Debit",
        credit_column="Amount Credit",
        date_format="%m/%d/%Y",
        amount="Amount",  # unused in split mode but required by schema
        skip_rows=3,      # skip 3 metadata rows (Account Name, Account Number, Date Range)
    ),
    "generic": CSVColumnMapping(),  # assumes standard column names
}


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _normalize_header(header: str) -> str:
    """Strip whitespace and lowercase a CSV column header."""
    return header.strip().lower()


def _find_column(df_columns: list[str], target: str) -> Optional[str]:
    """
    Case-insensitive column lookup.
    Returns the actual column name in the DataFrame, or None if not found.
    """
    target_norm = _normalize_header(target)
    for col in df_columns:
        if _normalize_header(col) == target_norm:
            return col
    return None


def _parse_amount(value) -> Optional[float]:
    """
    Parse a currency string or number into a float.
    Handles: "$1,234.56", "(1,234.56)", "1234.56", "-1234.56", ""
    """
    if pd.isna(value):
        return None
    s = str(value).strip()
    if not s:
        return None
    # Remove currency symbols, spaces, commas
    s = re.sub(r"[$£€,\s]", "", s)
    # Handle accounting negatives: (1234.56) -> -1234.56
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return None


def _compute_dedup_hash(account_id: int, tx_date: date, amount: float, description: str) -> str:
    """
    Deterministic hash for duplicate detection.
    Two transactions are considered the same if they share all four fields.
    """
    key = f"{account_id}|{tx_date.isoformat()}|{amount:.2f}|{description.strip().lower()}"
    return hashlib.sha256(key.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Core parser
# ---------------------------------------------------------------------------

def parse_csv(
    file_contents: bytes,
    account_id: int,
    mapping: CSVColumnMapping,
) -> tuple[list[ParsedTransaction], list[str]]:
    """
    Parse a CSV file into a list of ParsedTransaction objects.

    Returns:
        (transactions, errors) where errors is a list of human-readable
        row-level parse problems (non-fatal — we skip bad rows and continue).
    """
    errors: list[str] = []
    transactions: list[ParsedTransaction] = []

    # Try to read the CSV, skipping common bank header/footer garbage
    try:
        df = pd.read_csv(
            io.BytesIO(file_contents),
            dtype=str,
            skip_blank_lines=True,
            skiprows=mapping.skip_rows if mapping.skip_rows > 0 else None,
        )
    except Exception as e:
        return [], [f"Could not parse CSV file: {e}"]

    # Drop rows that are entirely empty
    df = df.dropna(how="all")

    if df.empty:
        return [], ["CSV file contains no data rows."]

    columns = list(df.columns)

    # Locate required columns
    date_col = _find_column(columns, mapping.date)
    desc_col = _find_column(columns, mapping.description)

    if not date_col:
        return [], [f"Required column '{mapping.date}' not found. Available: {columns}"]
    if not desc_col:
        return [], [f"Required column '{mapping.description}' not found. Available: {columns}"]

    # Locate amount columns based on format
    amount_col = debit_col = credit_col = None

    if mapping.amount_format == "split":
        if not mapping.debit_column or not mapping.credit_column:
            return [], ["amount_format='split' requires debit_column and credit_column to be set."]
        debit_col = _find_column(columns, mapping.debit_column)
        credit_col = _find_column(columns, mapping.credit_column)
        if not debit_col and not credit_col:
            return [], [
                f"Neither debit column '{mapping.debit_column}' nor "
                f"credit column '{mapping.credit_column}' found. Available: {columns}"
            ]
    else:
        amount_col = _find_column(columns, mapping.amount)
        if not amount_col:
            return [], [f"Required column '{mapping.amount}' not found. Available: {columns}"]

    # Optional columns
    merchant_col = _find_column(columns, mapping.merchant) if mapping.merchant else None
    type_col = _find_column(columns, mapping.transaction_type) if mapping.transaction_type else None
    cat_col = _find_column(columns, mapping.category) if mapping.category else None

    # Parse rows
    for row_num, (_, row) in enumerate(df.iterrows(), start=2):  # row 1 = header
        # --- Date ---
        raw_date = str(row[date_col]).strip() if pd.notna(row[date_col]) else ""
        if not raw_date or raw_date.lower() in ("nan", ""):
            errors.append(f"Row {row_num}: empty date, skipping.")
            continue
        try:
            tx_date = datetime.strptime(raw_date, mapping.date_format).date()
        except ValueError:
            errors.append(f"Row {row_num}: cannot parse date '{raw_date}' with format '{mapping.date_format}'.")
            continue

        # --- Description ---
        raw_desc = str(row[desc_col]).strip() if pd.notna(row[desc_col]) else ""
        if not raw_desc or raw_desc.lower() in ("nan", ""):
            raw_desc = "(no description)"

        # --- Merchant ---
        merchant = None
        if merchant_col and pd.notna(row.get(merchant_col)):
            merchant = str(row[merchant_col]).strip() or None

        # --- Bank category → app category name ---
        category_name: Optional[str] = None
        if cat_col and mapping.category_map:
            raw_cat = str(row.get(cat_col, "")).strip() if pd.notna(row.get(cat_col)) else ""
            if raw_cat and raw_cat.lower() not in ("nan", "", "category pending"):
                cat_lower = raw_cat.lower()
                category_name = next(
                    (v for k, v in mapping.category_map.items() if k.lower() == cat_lower),
                    None,
                )

        # --- Amount and type ---
        tx_type: Optional[TransactionType] = None
        amount: Optional[float] = None

        if mapping.amount_format == "split":
            debit_val = _parse_amount(row.get(debit_col)) if debit_col else None
            credit_val = _parse_amount(row.get(credit_col)) if credit_col else None

            if debit_val and abs(debit_val) > 0:
                amount = abs(debit_val)
                tx_type = TransactionType.DEBIT
            elif credit_val and abs(credit_val) > 0:
                amount = abs(credit_val)
                tx_type = TransactionType.CREDIT
            else:
                errors.append(f"Row {row_num}: both debit and credit are empty/zero, skipping.")
                continue

        elif mapping.amount_format == "absolute":
            amount = _parse_amount(row.get(amount_col))
            if amount is None:
                errors.append(f"Row {row_num}: cannot parse amount '{row.get(amount_col)}', skipping.")
                continue
            amount = abs(amount)
            # Derive type from optional type column
            if type_col and pd.notna(row.get(type_col)):
                type_str = str(row[type_col]).strip().lower()
                if type_str in ("debit", "withdrawal", "purchase", "payment"):
                    tx_type = TransactionType.DEBIT
                elif type_str in ("credit", "deposit", "refund", "return"):
                    tx_type = TransactionType.CREDIT
            if tx_type is None:
                errors.append(f"Row {row_num}: cannot determine transaction type; defaulting to DEBIT.")
                tx_type = TransactionType.DEBIT

        elif mapping.amount_format == "signed_inverted":
            amount = _parse_amount(row.get(amount_col))
            if amount is None:
                errors.append(f"Row {row_num}: cannot parse amount '{row.get(amount_col)}', skipping.")
                continue
            # Positive = debit (money out), negative = credit (money in)
            tx_type = TransactionType.DEBIT if amount > 0 else TransactionType.CREDIT
            amount = abs(amount)

        else:  # "signed" (default)
            amount = _parse_amount(row.get(amount_col))
            if amount is None:
                errors.append(f"Row {row_num}: cannot parse amount '{row.get(amount_col)}', skipping.")
                continue
            # Positive = credit (money in), negative = debit (money out)
            tx_type = TransactionType.CREDIT if amount > 0 else TransactionType.DEBIT
            amount = abs(amount)

        if amount == 0:
            # Zero-amount rows are usually noise (column headers re-appearing, etc.)
            errors.append(f"Row {row_num}: zero amount, skipping.")
            continue

        dedup_hash = _compute_dedup_hash(account_id, tx_date, amount, raw_desc)

        transactions.append(ParsedTransaction(
            date=tx_date,
            amount=amount,
            transaction_type=tx_type,
            original_description=raw_desc,
            merchant_name=merchant,
            category_name=category_name,
            dedup_hash=dedup_hash,
        ))

    return transactions, errors


# ---------------------------------------------------------------------------
# Persistence layer
# ---------------------------------------------------------------------------

def persist_transactions(
    parsed: list[ParsedTransaction],
    account_id: int,
    import_source_id: int,
    db: Session,
) -> ImportResult:
    """
    Insert parsed transactions into the database, skipping duplicates against
    existing DB records only.

    Duplicate detection uses dedup_hash — a SHA256 of (account_id, date, amount, description).
    Re-uploading a CSV with an overlapping date range is safe. Identical rows within
    the same CSV are treated as distinct transactions (e.g. two checks for the same
    amount deposited on the same day) and are both imported.
    """
    result = ImportResult()
    if not parsed:
        return result

    # Build category name → id lookup (case-insensitive, loaded once)
    cat_name_to_id: dict[str, int] = {
        c.name.lower(): c.id for c in db.query(Category).all()
    }

    # Fetch all existing hashes for this account in one query for efficiency
    existing_hashes: set[str] = set(
        h for (h,) in db.query(Transaction.dedup_hash)
        .filter(
            Transaction.account_id == account_id,
            Transaction.dedup_hash.isnot(None),
        )
        .all()
    )

    # Build description → learned attributes lookup from prior transactions on this account.
    # Most-recently-set entry wins when multiple transactions share a description.
    # Captures category, transfer flag, budget-exclusion flag, and annualized flag.
    learned_attrs: dict[str, dict] = {}
    prior_rows = (
        db.query(
            Transaction.original_description,
            Transaction.category_id,
            Transaction.is_transfer,
            Transaction.exclude_from_budget,
            Transaction.is_annualized,
        )
        .filter(
            Transaction.account_id == account_id,
            Transaction.original_description.isnot(None),
            or_(
                Transaction.category_id.isnot(None),
                Transaction.is_transfer == True,
                Transaction.exclude_from_budget == True,
                Transaction.is_annualized == True,
            ),
        )
        .order_by(Transaction.date.asc(), Transaction.id.asc())
        .all()
    )
    for desc, cat_id, is_transfer, exclude_from_budget, is_annualized in prior_rows:
        learned_attrs[desc.strip().lower()] = {
            "category_id": cat_id,
            "is_transfer": is_transfer,
            "exclude_from_budget": exclude_from_budget,
            "is_annualized": is_annualized,
        }

    to_insert = []
    for pt in parsed:
        if pt.dedup_hash in existing_hashes:
            result.transactions_skipped += 1
            continue

        key = pt.original_description.strip().lower() if pt.original_description else None
        learned = learned_attrs.get(key) if key else None

        # Learned category takes priority over the CSV preset mapping
        cat_id = (
            (learned["category_id"] if learned else None)
            or (cat_name_to_id.get(pt.category_name.lower()) if pt.category_name else None)
        )
        to_insert.append(Transaction(
            account_id=account_id,
            import_source_id=import_source_id,
            date=pt.date,
            amount=pt.amount,
            transaction_type=pt.transaction_type,
            original_description=pt.original_description,
            description=pt.original_description,  # pre-fill; user can edit later
            merchant_name=pt.merchant_name,
            category_id=cat_id,
            is_transfer=learned["is_transfer"] if learned else False,
            exclude_from_budget=learned["exclude_from_budget"] if learned else False,
            is_annualized=learned["is_annualized"] if learned else False,
            dedup_hash=pt.dedup_hash,
        ))

    if to_insert:
        db.bulk_save_objects(to_insert)
        result.transactions_imported = len(to_insert)

    all_dates = [pt.date for pt in parsed]
    if all_dates:
        result.date_range_start = min(all_dates)
        result.date_range_end = max(all_dates)

    return result


def compute_file_hash(file_contents: bytes) -> str:
    """SHA256 hash of the raw file bytes — used to detect exact duplicate file uploads."""
    return hashlib.sha256(file_contents).hexdigest()


# ---------------------------------------------------------------------------
# Top-level orchestrator (called by the API endpoint)
# ---------------------------------------------------------------------------

def import_csv_file(
    file_contents: bytes,
    file_name: str,
    account_id: int,
    mapping: CSVColumnMapping,
    db: Session,
) -> tuple[Optional[ImportSource], ImportResult]:
    """
    Full import pipeline:
    1. Check if this exact file was already imported (file hash dedup)
    2. Parse CSV into ParsedTransaction objects
    3. Persist new transactions, skipping duplicates
    4. Create and return an ImportSource audit record

    Returns (ImportSource | None, ImportResult).
    ImportSource is None when parsing produces zero rows — in that case the file
    hash is NOT saved, so the user can re-upload the same file with a different parser.
    """
    file_hash = compute_file_hash(file_contents)

    # Check for exact duplicate file upload
    existing_source = (
        db.query(ImportSource)
        .filter(
            ImportSource.account_id == account_id,
            ImportSource.file_hash == file_hash,
        )
        .first()
    )
    if existing_source:
        # Return the original import record — don't re-process
        return existing_source, ImportResult(
            transactions_skipped=existing_source.transactions_imported,
            errors=["This exact file was already imported (duplicate file detected)."],
        )

    # Parse first — don't write anything to the DB until we know rows were produced
    parsed_transactions, parse_errors = parse_csv(file_contents, account_id, mapping)

    # If parsing produced zero rows, return without saving the file hash so the
    # user can retry the same file with a different parser or column mapping
    if not parsed_transactions:
        errors = parse_errors or ["No transactions could be parsed from this file."]
        return None, ImportResult(errors=errors)

    # Create the ImportSource record (we need its ID for the transaction FK)
    import_source = ImportSource(
        account_id=account_id,
        source_type=ImportSourceType.CSV,
        file_name=file_name,
        file_hash=file_hash,
        is_successful=True,
    )
    db.add(import_source)
    db.flush()  # get import_source.id

    # Persist
    result = persist_transactions(parsed_transactions, account_id, import_source.id, db)
    result.errors.extend(parse_errors)

    # Update the ImportSource with results
    import_source.transactions_imported = result.transactions_imported
    import_source.transactions_skipped = result.transactions_skipped
    import_source.date_range_start = result.date_range_start
    import_source.date_range_end = result.date_range_end

    db.commit()
    return import_source, result

