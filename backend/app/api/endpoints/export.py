import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Transaction, Account, BalanceSnapshot, Category

router = APIRouter()


def _csv_response(rows: list[dict], fieldnames: list[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction='ignore', lineterminator='\r\n')
    writer.writeheader()
    writer.writerows(rows)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.read()]),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@router.get("/transactions")
def export_transactions(db: Session = Depends(get_db)):
    """Export all transactions as a CSV file."""
    # Single query with joins to avoid N+1
    txns = (
        db.query(Transaction)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .all()
    )

    # Build account and category name lookups
    account_map = {a.id: a.name for a in db.query(Account).all()}
    cat_map = {c.id: c.name for c in db.query(Category).all()}

    rows = []
    for t in txns:
        rows.append({
            'id': t.id,
            'date': t.date.isoformat() if t.date else '',
            'account': account_map.get(t.account_id, ''),
            'amount': f'{t.amount:.2f}',
            'type': t.transaction_type.value if t.transaction_type else '',
            'description': t.description or t.original_description or '',
            'merchant': t.merchant_name or '',
            'category': cat_map.get(t.category_id, '') if t.category_id else '',
            'is_transfer': 'true' if t.is_transfer else 'false',
            'exclude_from_budget': 'true' if t.exclude_from_budget else 'false',
            'is_annualized': 'true' if t.is_annualized else 'false',
            'notes': t.notes or '',
        })

    filename = f'transactions_{datetime.utcnow().strftime("%Y%m%d")}.csv'
    fieldnames = ['id', 'date', 'account', 'amount', 'type', 'description',
                  'merchant', 'category', 'is_transfer', 'exclude_from_budget',
                  'is_annualized', 'notes']
    return _csv_response(rows, fieldnames, filename)


@router.get("/balances")
def export_balances(db: Session = Depends(get_db)):
    """Export all balance snapshots as a CSV file."""
    snapshots = (
        db.query(BalanceSnapshot)
        .order_by(BalanceSnapshot.snapshot_date.desc(), BalanceSnapshot.account_id)
        .all()
    )

    account_map = {a.id: a for a in db.query(Account)}

    rows = []
    for s in snapshots:
        acct = account_map.get(s.account_id)
        rows.append({
            'account': acct.name if acct else '',
            'account_type': acct.account_type.value if acct and acct.account_type else '',
            'snapshot_date': s.snapshot_date.isoformat() if s.snapshot_date else '',
            'balance': f'{s.balance:.2f}',
            'notes': s.notes or '',
        })

    filename = f'balance_history_{datetime.utcnow().strftime("%Y%m%d")}.csv'
    fieldnames = ['account', 'account_type', 'snapshot_date', 'balance', 'notes']
    return _csv_response(rows, fieldnames, filename)


