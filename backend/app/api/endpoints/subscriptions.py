"""
subscriptions.py — Per-merchant overrides for the subscription report.

The report itself lives at /reports/subscriptions (read-only, like all
reports). These endpoints manage the SubscriptionRule rows that dismiss
detected merchants (rule='exclude'), force-track missed ones
(rule='include'), rename a subscription (nickname), pin its cadence or
status, or link merchant keys together so drifting descriptors report as
one subscription (alias_of). They also create and edit manual entries —
subscriptions the user declared outright, which need no charges at all.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import SubscriptionRule, Transaction
from app.models.user import User
from app.schemas.subscriptions import (
    ManualEntryUpdate,
    ManualSubscriptionCreate,
    MerchantKeyResolution,
    MerchantKeyResolveRequest,
    SubscriptionCadenceUpsert,
    SubscriptionLinkRequest,
    SubscriptionNicknameUpsert,
    SubscriptionRuleRead,
    SubscriptionRuleUpsert,
    SubscriptionStatusUpsert,
    SubscriptionUnlinkRequest,
)
from app.services.subscriptions import (
    create_manual_entry,
    delete_manual_entry,
    link_merchants,
    normalize_merchant,
    remove_rule,
    set_cadence_override,
    set_nickname,
    set_status_override,
    unlink_merchant,
    update_manual_entry,
)

router = APIRouter()


@router.get("/rules", response_model=list[SubscriptionRuleRead])
def list_rules(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(SubscriptionRule)
        .filter(SubscriptionRule.user_id == user.id)
        .order_by(SubscriptionRule.merchant_key)
        .all()
    )


@router.put("/rules", response_model=SubscriptionRuleRead)
def upsert_rule(
    payload: SubscriptionRuleUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update the rule for a merchant key (idempotent)."""
    row = (
        db.query(SubscriptionRule)
        .filter(
            SubscriptionRule.user_id == user.id,
            SubscriptionRule.merchant_key == payload.merchant_key,
        )
        .first()
    )
    if row:
        row.rule = payload.rule
    else:
        row = SubscriptionRule(
            user_id=user.id,
            merchant_key=payload.merchant_key,
            rule=payload.rule,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove the include/exclude decision (Untrack/Restore in the UI).

    Any nickname or link the row also carries survives.
    """
    if not remove_rule(db, user.id, rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")


@router.put("/nickname", status_code=status.HTTP_204_NO_CONTENT)
def upsert_nickname(
    payload: SubscriptionNicknameUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Set or clear (nickname omitted/blank) a merchant's display nickname."""
    set_nickname(db, user.id, payload.merchant_key, payload.nickname)


@router.put("/cadence", status_code=status.HTTP_204_NO_CONTENT)
def upsert_cadence(
    payload: SubscriptionCadenceUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Set or clear (cadence omitted) a merchant's forced billing cadence."""
    try:
        set_cadence_override(db, user.id, payload.merchant_key, payload.cadence)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/status", status_code=status.HTTP_204_NO_CONTENT)
def upsert_status(
    payload: SubscriptionStatusUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pin a merchant's status, or clear it (status omitted) back to detection."""
    set_status_override(db, user.id, payload.merchant_key, payload.status)


@router.post("/manual", response_model=SubscriptionRuleRead, status_code=status.HTTP_201_CREATED)
def add_manual(
    payload: ManualSubscriptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manually track a subscription.

    It gets its own synthetic merchant key, so it exists independently of
    any transaction; merchant keys picked off transactions are linked into
    it. amount/cadence are required when none are.
    """
    try:
        return create_manual_entry(
            db,
            user.id,
            payload.name,
            payload.amount,
            payload.cadence,
            payload.start_date,
            payload.merchant_keys,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/manual", status_code=status.HTTP_204_NO_CONTENT)
def edit_manual(
    payload: ManualEntryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Replace a manual entry's amount and billing anchor (omitting one clears it)."""
    try:
        found = update_manual_entry(
            db, user.id, payload.merchant_key, payload.amount, payload.start_date
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not found:
        raise HTTPException(status_code=404, detail="Subscription not found")


@router.delete("/manual/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_manual(
    rule_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a manual entry and release the merchants attached to it."""
    if not delete_manual_entry(db, user.id, rule_id):
        raise HTTPException(status_code=404, detail="Subscription not found")


@router.post("/resolve-keys", response_model=list[MerchantKeyResolution])
def resolve_merchant_keys(
    payload: MerchantKeyResolveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Normalized merchant key for each transaction (unknown ids omitted).

    Lets the UI turn a picked transaction into the merchant key that the
    subscription report groups by.
    """
    txs = db.query(Transaction).filter(Transaction.id.in_(payload.transaction_ids)).all()
    return [
        MerchantKeyResolution(transaction_id=tx.id, merchant_key=normalize_merchant(tx))
        for tx in txs
    ]


@router.post("/link", status_code=status.HTTP_204_NO_CONTENT)
def link(
    payload: SubscriptionLinkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Link merchant keys into target_key so they report as one subscription."""
    try:
        link_merchants(db, user.id, payload.target_key, payload.merchant_keys)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink(
    payload: SubscriptionUnlinkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Detach a merchant key from the subscription it was linked into."""
    unlink_merchant(db, user.id, payload.merchant_key)
