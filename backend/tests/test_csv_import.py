from app.models import Account, ImportSource
from app.models.enums import ImportSourceType, TransactionType
from app.schemas.imports import CSVColumnMapping
from app.services.csv_import import parse_csv, persist_transactions

SIGNED = CSVColumnMapping(
    date="Date", amount="Amount", description="Description",
    amount_format="signed", date_format="%m/%d/%Y",
)


def _account(db) -> Account:
    acct = Account(name="Checking", account_type="checking")
    db.add(acct)
    db.flush()
    return acct


def _source(db, account_id: int) -> ImportSource:
    src = ImportSource(account_id=account_id, source_type=ImportSourceType.CSV)
    db.add(src)
    db.flush()
    return src


# --- parse_csv: one test per amount format --------------------------------

def test_parse_signed():
    contents = b"Date,Description,Amount\n01/15/2025,COFFEE,-4.50\n01/16/2025,PAYROLL,2500.00\n"
    txs, errors = parse_csv(contents, 1, SIGNED)
    assert errors == []
    assert [(t.transaction_type, t.amount) for t in txs] == [
        (TransactionType.DEBIT, 4.50),
        (TransactionType.CREDIT, 2500.00),
    ]


def test_parse_signed_inverted():
    mapping = SIGNED.model_copy(update={"amount_format": "signed_inverted"})
    contents = b"Date,Description,Amount\n01/15/2025,CHARGE,34.99\n01/20/2025,PAYMENT,-500.00\n"
    txs, errors = parse_csv(contents, 1, mapping)
    assert errors == []
    assert [(t.transaction_type, t.amount) for t in txs] == [
        (TransactionType.DEBIT, 34.99),
        (TransactionType.CREDIT, 500.00),
    ]


def test_parse_absolute_with_type_column():
    mapping = SIGNED.model_copy(
        update={"amount_format": "absolute", "transaction_type": "Type"}
    )
    contents = (
        b"Date,Description,Amount,Type\n"
        b"01/15/2025,GROCERIES,52.34,debit\n"
        b"01/16/2025,REFUND,10.00,credit\n"
    )
    txs, errors = parse_csv(contents, 1, mapping)
    assert errors == []
    assert [(t.transaction_type, t.amount) for t in txs] == [
        (TransactionType.DEBIT, 52.34),
        (TransactionType.CREDIT, 10.00),
    ]


def test_parse_split_columns():
    mapping = SIGNED.model_copy(
        update={"amount_format": "split", "debit_column": "Debit", "credit_column": "Credit"}
    )
    contents = (
        b"Date,Description,Debit,Credit\n"
        b"01/15/2025,GROCERIES,52.34,\n"
        b"01/16/2025,DEPOSIT,,2500.00\n"
    )
    txs, errors = parse_csv(contents, 1, mapping)
    assert errors == []
    assert [(t.transaction_type, t.amount) for t in txs] == [
        (TransactionType.DEBIT, 52.34),
        (TransactionType.CREDIT, 2500.00),
    ]


def test_parse_currency_symbols_and_accounting_negatives():
    contents = b'Date,Description,Amount\n01/15/2025,BIG BUY,"$1,234.56"\n01/16/2025,REVERSAL,"(1,234.56)"\n'
    txs, errors = parse_csv(contents, 1, SIGNED)
    assert errors == []
    assert [(t.transaction_type, t.amount) for t in txs] == [
        (TransactionType.CREDIT, 1234.56),
        (TransactionType.DEBIT, 1234.56),
    ]


# --- persist_transactions: dedup semantics ---------------------------------

def test_reimport_skips_existing_rows(db):
    acct = _account(db)
    contents = b"Date,Description,Amount\n01/15/2025,COFFEE,-4.50\n01/16/2025,PAYROLL,2500.00\n"

    parsed, _ = parse_csv(contents, acct.id, SIGNED)
    result = persist_transactions(parsed, acct.id, _source(db, acct.id).id, db)
    db.commit()
    assert result.transactions_imported == 2

    parsed_again, _ = parse_csv(contents, acct.id, SIGNED)
    result2 = persist_transactions(parsed_again, acct.id, _source(db, acct.id).id, db)
    db.commit()
    assert result2.transactions_imported == 0
    assert result2.transactions_skipped == 2


def test_same_day_charge_and_refund_are_distinct(db):
    """A charge and its same-day refund share date/amount/description but
    differ in type — the refund must not be treated as a duplicate."""
    acct = _account(db)
    charge_only = b"Date,Description,Amount\n01/15/2025,ACME STORE,-42.00\n"
    parsed, _ = parse_csv(charge_only, acct.id, SIGNED)
    persist_transactions(parsed, acct.id, _source(db, acct.id).id, db)
    db.commit()

    both = (
        b"Date,Description,Amount\n"
        b"01/15/2025,ACME STORE,-42.00\n"   # duplicate of the charge
        b"01/15/2025,ACME STORE,42.00\n"    # refund — new
    )
    parsed2, _ = parse_csv(both, acct.id, SIGNED)
    result = persist_transactions(parsed2, acct.id, _source(db, acct.id).id, db)
    db.commit()
    assert result.transactions_skipped == 1
    assert result.transactions_imported == 1


def test_learned_category_applied_to_reimports(db):
    from app.models import Category, Transaction

    acct = _account(db)
    groceries = Category(name="Groceries", is_income=False)
    db.add(groceries)
    db.flush()

    contents = b"Date,Description,Amount\n01/15/2025,KROGER 123,-50.00\n"
    parsed, _ = parse_csv(contents, acct.id, SIGNED)
    persist_transactions(parsed, acct.id, _source(db, acct.id).id, db)
    db.commit()

    # User categorizes the imported transaction…
    tx = db.query(Transaction).one()
    tx.category_id = groceries.id
    db.commit()

    # …a later import of the same description inherits the category.
    later = b"Date,Description,Amount\n02/15/2025,KROGER 123,-61.25\n"
    parsed2, _ = parse_csv(later, acct.id, SIGNED)
    persist_transactions(parsed2, acct.id, _source(db, acct.id).id, db)
    db.commit()

    new_tx = (
        db.query(Transaction)
        .filter(Transaction.amount == 61.25)
        .one()
    )
    assert new_tx.category_id == groceries.id
