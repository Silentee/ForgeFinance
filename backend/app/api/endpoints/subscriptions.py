"""
subscriptions.py — Per-merchant overrides for the subscription report.

The report itself lives at /reports/subscriptions (read-only, like all
reports). These endpoints manage the SubscriptionRule rows that dismiss
detected merchants (rule='exclude'), force-track missed ones
(rule='include'), rename a subscription (nickname), or link merchant keys
together so drifting descriptors report as one subscription (alias_of).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import SubscriptionRule
from app.models.user import User
from app.schemas.subscriptions import (
    SubscriptionLinkRequest,
    SubscriptionNicknameUpsert,
    SubscriptionRuleRead,
    SubscriptionRuleUpsert,
    SubscriptionUnlinkRequest,
)
from app.services.subscriptions import (
    link_merchants,
    remove_rule,
    set_nickname,
    unlink_merchant,
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
