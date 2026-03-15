"""
imports.py — API endpoints for CSV file import and import history.

The upload endpoint accepts a CSV file + optional column mapping config,
runs the import service, and returns a structured result.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account, ImportSource
from app.schemas.imports import CSVColumnMapping, CSVImportResult, ImportSourceRead
from app.services.csv_import import BANK_PRESETS, import_csv_file
from app.core.config import settings

router = APIRouter()

MAX_BYTES = settings.max_csv_file_size_mb * 1024 * 1024


@router.get("/presets", response_model=dict[str, CSVColumnMapping])
def list_presets():
    """
    Return all available bank CSV presets.
    The frontend can display these in a dropdown so users don't have to
    manually configure column mappings.
    """
    return BANK_PRESETS


@router.post("/csv", response_model=CSVImportResult, status_code=status.HTTP_201_CREATED)
async def upload_csv(
    account_id: int = Form(..., description="ID of the account this CSV belongs to"),
    file: UploadFile = File(..., description="CSV file exported from your bank"),
    preset: Optional[str] = Form(
        None,
        description=(
            "Bank preset name (e.g. 'chase_checking'). "
            "If provided, column_mapping is ignored. "
            "Use GET /imports/presets to see available presets."
        ),
    ),
    column_mapping: Optional[str] = Form(
        None,
        description=(
            "JSON-encoded CSVColumnMapping object. "
            "Only needed if no preset matches your bank. "
            "Example: {\"date\": \"Trans Date\", \"amount\": \"Amount\", "
            "\"description\": \"Memo\", \"amount_format\": \"signed\", "
            "\"date_format\": \"%m/%d/%Y\"}"
        ),
    ),
    db: Session = Depends(get_db),
):
    """
    Upload a CSV file and import its transactions into the specified account.

    The endpoint handles:
    - File size validation
    - Exact duplicate file detection (same file uploaded twice = no double import)
    - Row-level duplicate detection (overlapping date ranges = no double transactions)
    - Structured error reporting for unparseable rows

    Workflow:
    1. Export CSV from your bank's website
    2. Note the account you're importing into
    3. Pick the matching preset (or supply a custom mapping)
    4. POST to this endpoint
    5. Review the returned counts — re-uploads are always safe
    """
    # Validate account exists
    account = db.query(Account).get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found")

    # File size check
    contents = await file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {settings.max_csv_file_size_mb}MB.",
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Resolve column mapping
    mapping: CSVColumnMapping
    if preset:
        if preset not in BANK_PRESETS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unknown preset '{preset}'. "
                    f"Available presets: {list(BANK_PRESETS.keys())}"
                ),
            )
        mapping = BANK_PRESETS[preset]
    elif column_mapping:
        try:
            mapping_data = json.loads(column_mapping)
            mapping = CSVColumnMapping(**mapping_data)
        except (json.JSONDecodeError, Exception) as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid column_mapping JSON: {e}",
            )
    else:
        # Fall back to generic defaults
        mapping = BANK_PRESETS["generic"]

    # Run import
    import_source, result = import_csv_file(
        file_contents=contents,
        file_name=file.filename or "upload.csv",
        account_id=account_id,
        mapping=mapping,
        db=db,
    )

    return CSVImportResult(
        import_source_id=import_source.id if import_source else None,
        account_id=account_id,
        file_name=file.filename or "upload.csv",
        transactions_imported=result.transactions_imported,
        transactions_skipped=result.transactions_skipped,
        date_range_start=result.date_range_start,
        date_range_end=result.date_range_end,
        errors=result.errors,
        is_successful=bool(import_source and import_source.is_successful),
    )


@router.get("", response_model=list[ImportSourceRead])
def list_imports(
    account_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """List past imports, optionally filtered by account. Most recent first."""
    q = db.query(ImportSource)
    if account_id is not None:
        q = q.filter(ImportSource.account_id == account_id)
    return q.order_by(ImportSource.imported_at.desc()).limit(limit).all()


@router.get("/{import_id}", response_model=ImportSourceRead)
def get_import(import_id: int, db: Session = Depends(get_db)):
    """Get details of a specific import."""
    source = db.query(ImportSource).get(import_id)
    if not source:
        raise HTTPException(status_code=404, detail="Import record not found")
    return source


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import(
    import_id: int,
    delete_transactions: bool = Query(
        False,
        description="If True, also delete all transactions created by this import.",
    ),
    db: Session = Depends(get_db),
):
    """
    Delete an import record.
    By default the transactions it created are kept (they become 'manually entered').
    Pass delete_transactions=true to also purge those transactions.
    """
    source = db.query(ImportSource).get(import_id)
    if not source:
        raise HTTPException(status_code=404, detail="Import record not found")

    if delete_transactions:
        from app.models import Transaction
        db.query(Transaction).filter(
            Transaction.import_source_id == import_id
        ).delete(synchronize_session=False)

    db.delete(source)
    db.commit()
