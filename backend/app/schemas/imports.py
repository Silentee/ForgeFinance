from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel

from app.models.enums import ImportSourceType


class ImportSourceRead(BaseModel):
    id: int
    account_id: int
    source_type: ImportSourceType
    file_name: Optional[str] = None
    file_hash: Optional[str] = None
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    transactions_imported: int
    transactions_skipped: int
    is_successful: bool
    error_message: Optional[str] = None
    imported_at: datetime

    model_config = {"from_attributes": True}


class CSVImportResult(BaseModel):
    """Response returned after a CSV upload."""
    import_source_id: Optional[int] = None
    account_id: int
    file_name: str
    transactions_imported: int
    transactions_skipped: int   # duplicates detected via dedup_hash
    date_range_start: Optional[date] = None
    date_range_end: Optional[date] = None
    errors: list[str] = []      # row-level parse errors (non-fatal)
    is_successful: bool


class CSVColumnMapping(BaseModel):
    """
    Tells the import service which CSV columns map to which fields.
    Different banks export CSVs with different column names, so this
    mapping is provided per-import (or stored per-institution).

    All fields are the CSV column header names (case-insensitive).
    """
    date: str = "Date"
    amount: str = "Amount"
    description: str = "Description"

    # Optional columns — if absent, we derive or leave null
    transaction_type: Optional[str] = None  # e.g. "Transaction Type" column
    merchant: Optional[str] = None
    category: Optional[str] = None          # bank-provided category (we may override)

    # How to interpret the amount column:
    # "signed"     — positive = credit, negative = debit (most common)
    # "absolute"   — always positive; requires transaction_type column or separate debit/credit cols
    # "split"      — separate debit and credit columns
    amount_format: str = "signed"

    # For "split" format: which columns hold debit and credit amounts
    debit_column: Optional[str] = None
    credit_column: Optional[str] = None

    # Date format string for parsing (Python strptime format)
    date_format: str = "%Y-%m-%d"

    # Number of non-header rows to skip at the top of the file (e.g. bank metadata rows)
    skip_rows: int = 0

    # Maps bank-provided category labels → app category names (case-insensitive keys)
    category_map: dict[str, str] = {}


class BalanceSnapshotCreate(BaseModel):
    account_id: int
    snapshot_date: date
    balance: float
    notes: Optional[str] = None


class BalanceSnapshotRead(BaseModel):
    id: int
    account_id: int
    snapshot_date: date
    balance: float
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BalanceSnapshotUpdate(BaseModel):
    snapshot_date: Optional[date] = None
    balance: Optional[float] = None
    notes: Optional[str] = None
