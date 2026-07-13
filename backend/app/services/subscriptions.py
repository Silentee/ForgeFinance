"""
services/subscriptions.py

Recurring-charge (subscription) detection for the /reports/subscriptions
endpoint.

Detection is merchant-level: transactions are grouped by a normalized
merchant key, then each group's charge dates and amounts are tested for a
regular cadence and similar amounts. Per-merchant SubscriptionRule rows
override the heuristics ('exclude' dismisses a detected merchant, 'include'
force-tracks one that failed detection).

Transactions categorized as 'Subscriptions' are treated as explicitly
tagged: their merchant always appears in the report even when detection
fails (down to a single one-off charge), and `tagged_only` restricts the
whole report to such transactions.
"""

import re
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import NamedTuple, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Category, SubscriptionRule, Transaction
from app.models.enums import TransactionType
from app.schemas.subscriptions import (
    SubscriptionCandidate,
    SubscriptionItem,
    SubscriptionsReport,
)
from app.services.reporting import _add_months, _first_day_of_month

# Payment-processor prefixes that obscure the real merchant name.
# Checked after lowercasing; longest-first so e.g. "sq *" wins over "sq".
_PROCESSOR_PREFIXES = (
    "recurring payment ",
    "debit card purchase ",
    "paypal *",
    "paypal ",
    "tst* ",
    "tst *",
    "apl* ",
    "apl *",
    "sq *",
    "sq*",
    "pp*",
    "pos ",
    "ach ",
)

_REFERENCE_TOKEN_RE = re.compile(r"[#*]\S+")
_DATE_RE = re.compile(r"\d{1,2}/\d{1,2}(/\d{2,4})?")
_LONG_DIGITS_RE = re.compile(r"\d{3,}")
_TLD_RE = re.compile(r"\.(com|net|org|io|co|tv)\b")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9& ]+")

# cadence -> (min interval days, max interval days, periods per year)
CADENCE_BUCKETS: dict[str, tuple[int, int, int]] = {
    "weekly": (5, 10, 52),
    "biweekly": (11, 18, 26),
    "monthly": (26, 35, 12),
    "quarterly": (80, 100, 4),
    "semiannual": (165, 200, 2),
    "annual": (350, 380, 1),
}

# Cadences sparse enough that a lookback window can only hold a couple
# of occurrences, so they get a lower minimum-occurrence threshold.
_SPARSE_CADENCES = {"semiannual", "annual"}
MIN_OCCURRENCES = 3
MIN_OCCURRENCES_SPARSE = 2

# Fraction of intervals that must land in the matched cadence bucket
# (tolerates a skipped month or a duplicate charge).
INTERVAL_REGULARITY = 0.6
# Fraction of amounts that must sit within tolerance of the median amount.
AMOUNT_REGULARITY = 0.7
# Amount tolerance: max(20% of median, $1) absorbs ordinary price changes.
AMOUNT_TOLERANCE_PCT = 0.20
AMOUNT_TOLERANCE_FLOOR = 1.00
# A subscription is lapsed once the gap since its last charge exceeds
# 1.5x its observed cadence.
LAPSED_INTERVAL_FACTOR = 1.5


def normalize_merchant(tx: Transaction) -> str:
    """Collapse a transaction's merchant text into a stable grouping key.

    Prefers merchant_name, then the user-edited description, then the raw
    bank string. Strips processor prefixes, reference tokens, dates, and
    store/phone numbers so 'NETFLIX.COM #12345' and 'Netflix.com' group
    together.
    """
    raw = tx.merchant_name or tx.description or tx.original_description or ""
    text = raw.strip().lower()

    for prefix in _PROCESSOR_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):]
            break

    text = _REFERENCE_TOKEN_RE.sub(" ", text)
    text = _DATE_RE.sub(" ", text)
    text = _LONG_DIGITS_RE.sub(" ", text)
    text = _TLD_RE.sub(" ", text)
    text = _NON_ALNUM_RE.sub(" ", text)
    text = " ".join(text.split())[:60]

    # Never let a merchant vanish because normalization ate everything.
    return text if text else raw.strip().lower()


def _resolve_alias(key: str, alias_map: dict[str, str]) -> str:
    """Follow alias links to the canonical merchant key.

    Links are flattened at write time (see link_merchants), so this is
    normally a single hop; the visited set guards against a cycle ever
    sneaking into the data.
    """
    seen = {key}
    while key in alias_map:
        key = alias_map[key]
        if key in seen:
            break
        seen.add(key)
    return key


def _get_candidate_transactions(
    db: Session,
    date_from: date,
    account_ids: Optional[list[int]] = None,
    category_ids: Optional[set[int]] = None,
) -> list[Transaction]:
    """Debits eligible for recurrence detection.

    Unlike budget reports, is_annualized rows are included: annualized is a
    budget-spreading flag and an annualized annual charge is exactly the kind
    of subscription this report exists to surface.

    category_ids restricts to those categories (None means no restriction;
    an empty set matches nothing — used by tagged_only when no 'Subscriptions'
    category exists).
    """
    q = db.query(Transaction).filter(
        Transaction.date >= date_from,
        Transaction.transaction_type == TransactionType.DEBIT,
        Transaction.is_transfer == False,
        Transaction.is_pending == False,
        Transaction.exclude_from_budget == False,
    )
    if account_ids:
        q = q.filter(Transaction.account_id.in_(account_ids))
    if category_ids is not None:
        q = q.filter(Transaction.category_id.in_(category_ids))
    return q.all()


def _collapse_occurrences(txs: list[Transaction]) -> list[tuple[date, float]]:
    """One occurrence per distinct date (same-day charges summed), sorted."""
    by_date: dict[date, float] = defaultdict(float)
    for tx in txs:
        by_date[tx.date] += float(tx.amount)
    return sorted(by_date.items())


def _infer_cadence(intervals: list[int]) -> tuple[Optional[str], float]:
    """Match the median interval to a cadence bucket.

    Returns (cadence_name, median_interval); cadence_name is None when the
    median lands outside every bucket or too few intervals sit inside the
    matched bucket's range.
    """
    if not intervals:
        return None, 0.0
    median_interval = float(statistics.median(intervals))
    for name, (lo, hi, _) in CADENCE_BUCKETS.items():
        if lo <= median_interval <= hi:
            in_bucket = sum(1 for i in intervals if lo <= i <= hi)
            if in_bucket / len(intervals) >= INTERVAL_REGULARITY:
                return name, median_interval
            return None, median_interval
    return None, median_interval


def _amounts_similar(amounts: list[float]) -> bool:
    median_amount = statistics.median(amounts)
    tolerance = max(AMOUNT_TOLERANCE_PCT * median_amount, AMOUNT_TOLERANCE_FLOOR)
    within = sum(1 for a in amounts if abs(a - median_amount) <= tolerance)
    return within / len(amounts) >= AMOUNT_REGULARITY


class _GroupStats(NamedTuple):
    occurrences: list[tuple[date, float]]
    display_name: str
    category_id: Optional[int]
    category_name: Optional[str]
    cadence: Optional[str]
    median_interval: float
    amounts_ok: bool


def _analyze_group(
    merchant_key: str,
    txs: list[Transaction],
    cat_names: dict[int, str],
) -> _GroupStats:
    """Occurrence/cadence/amount statistics for one merchant group.

    Also run on the tagged subset of a group, so charges the user explicitly
    categorized as subscriptions aren't polluted by unrelated spending at the
    same merchant.
    """
    occurrences = _collapse_occurrences(txs)

    raw_names = Counter(
        (tx.merchant_name or tx.description or tx.original_description or "").strip()
        for tx in txs
    )
    display_name = raw_names.most_common(1)[0][0] or merchant_key

    group_cat_ids = Counter(tx.category_id for tx in txs if tx.category_id is not None)
    category_id = group_cat_ids.most_common(1)[0][0] if group_cat_ids else None
    category_name = cat_names.get(category_id) if category_id is not None else None

    dates = [d for d, _ in occurrences]
    amounts = [a for _, a in occurrences]
    intervals = [(b - a).days for a, b in zip(dates, dates[1:])]
    cadence, median_interval = _infer_cadence(intervals)
    amounts_ok = _amounts_similar(amounts)

    return _GroupStats(
        occurrences, display_name, category_id, category_name,
        cadence, median_interval, amounts_ok,
    )


def _build_item(
    merchant_key: str,
    g: _GroupStats,
    months: int,
    is_manual: bool,
    is_tagged: bool,
    rule_id: Optional[int],
    today: date,
    nickname: Optional[str] = None,
    linked_keys: Optional[list[str]] = None,
) -> SubscriptionItem:
    cadence = g.cadence
    median_interval = g.median_interval
    dates = [d for d, _ in g.occurrences]
    amounts = [a for _, a in g.occurrences]
    last_charged = dates[-1]
    amount = amounts[-1]

    previous_amount = round(statistics.median(amounts[:-1]), 2) if len(amounts) > 1 else None
    price_increased = (
        previous_amount is not None
        and amount > previous_amount * 1.02
        and amount - previous_amount > 0.01
    )
    price_change_pct = (
        round((amount / previous_amount - 1) * 100, 1) if price_increased else None
    )

    if cadence is not None:
        periods_per_year = CADENCE_BUCKETS[cadence][2]
        monthly_equivalent = round(amount * periods_per_year / 12.0, 2)
        next_expected = last_charged + timedelta(days=round(median_interval))
        lapsed_after_days = LAPSED_INTERVAL_FACTOR * median_interval
    else:
        cadence = "irregular"
        monthly_equivalent = round(sum(amounts) / months, 2)
        next_expected = None
        lapsed_after_days = max(90.0, 2 * median_interval)

    status = "lapsed" if (today - last_charged).days > lapsed_after_days else "active"

    return SubscriptionItem(
        merchant_key=merchant_key,
        display_name=g.display_name,
        nickname=nickname,
        linked_keys=linked_keys or [],
        cadence=cadence,
        status=status,
        amount=round(amount, 2),
        previous_amount=previous_amount,
        price_increased=price_increased,
        price_change_pct=price_change_pct,
        first_charged=dates[0].isoformat(),
        last_charged=last_charged.isoformat(),
        next_expected=next_expected.isoformat() if next_expected else None,
        occurrence_count=len(g.occurrences),
        monthly_equivalent=monthly_equivalent,
        annual_equivalent=round(monthly_equivalent * 12, 2),
        total_in_window=round(sum(amounts), 2),
        category_id=g.category_id,
        category_name=g.category_name,
        is_manual=is_manual,
        is_tagged=is_tagged,
        rule_id=rule_id,
        recent_dates=[d.isoformat() for d in dates[-12:]],
        recent_amounts=[round(a, 2) for a in amounts[-12:]],
    )


def build_subscriptions_report(
    db: Session,
    user_id: int,
    months: int = 24,
    account_ids: Optional[list[int]] = None,
    tagged_only: bool = False,
) -> SubscriptionsReport:
    today = date.today()
    start_year, start_month = _add_months(today.year, today.month, -(months - 1))
    date_from = _first_day_of_month(start_year, start_month)

    # Transactions in any category named 'Subscriptions' count as explicitly
    # tagged. Name-matched (case-insensitively) rather than pinned to the
    # seeded category so user-created duplicates work too.
    tagged_cat_ids: set[int] = {
        cid
        for (cid,) in db.query(Category.id)
        .filter(func.lower(Category.name) == "subscriptions")
        .all()
    }

    txs = _get_candidate_transactions(
        db, date_from, account_ids, tagged_cat_ids if tagged_only else None
    )

    rules = {
        r.merchant_key: r
        for r in db.query(SubscriptionRule).filter(SubscriptionRule.user_id == user_id).all()
    }

    # User-linked merchant keys collapse into their canonical key before
    # analysis, so a merged group's cadence/amount checks run over the
    # combined charge series.
    alias_map = {r.merchant_key: r.alias_of for r in rules.values() if r.alias_of}
    linked_children: dict[str, list[str]] = defaultdict(list)
    for key in alias_map:
        linked_children[_resolve_alias(key, alias_map)].append(key)

    groups: dict[str, list[Transaction]] = defaultdict(list)
    for tx in txs:
        groups[_resolve_alias(normalize_merchant(tx), alias_map)].append(tx)

    # One Category lookup covers every group's dominant-category resolution.
    cat_ids = {tx.category_id for tx in txs if tx.category_id is not None}
    cat_names = (
        {c.id: c.name for c in db.query(Category).filter(Category.id.in_(cat_ids)).all()}
        if cat_ids
        else {}
    )

    subscriptions: list[SubscriptionItem] = []
    dismissed: list[SubscriptionItem] = []
    candidates: list[SubscriptionCandidate] = []

    for merchant_key, group_txs in groups.items():
        rule = rules.get(merchant_key)
        nickname = rule.nickname if rule is not None else None
        linked_keys = sorted(linked_children.get(merchant_key, []))
        tagged_txs = [tx for tx in group_txs if tx.category_id in tagged_cat_ids]
        has_tagged = bool(tagged_txs)

        full = _analyze_group(merchant_key, group_txs, cat_names)
        occurrences = full.occurrences
        # A lone charge is normally invisible to detection, but a tagged one
        # was explicitly marked by the user and must still surface.
        if len(occurrences) < 2 and not has_tagged:
            continue

        cadence, amounts_ok = full.cadence, full.amounts_ok
        min_needed = (
            MIN_OCCURRENCES_SPARSE if cadence in _SPARSE_CADENCES else MIN_OCCURRENCES
        )
        detected = cadence is not None and amounts_ok and len(occurrences) >= min_needed

        if rule is not None and rule.rule == "exclude":
            if detected:
                dismissed.append(
                    _build_item(merchant_key, full, months, False, has_tagged, rule.id, today,
                                nickname, linked_keys)
                )
            elif has_tagged:
                # Tagged but undetected: still restorable from the dismissed list.
                tagged_stats = _analyze_group(merchant_key, tagged_txs, cat_names)
                dismissed.append(
                    _build_item(merchant_key, tagged_stats, months, False, True, rule.id, today,
                                nickname, linked_keys)
                )
            continue

        if rule is not None and rule.rule == "include":
            subscriptions.append(
                _build_item(merchant_key, full, months, True, has_tagged, rule.id, today,
                            nickname, linked_keys)
            )
            continue

        if detected:
            subscriptions.append(
                _build_item(merchant_key, full, months, False, has_tagged, None, today,
                            nickname, linked_keys)
            )
        elif has_tagged:
            # Failed detection but the user tagged charges here: force the
            # merchant in, built from only the tagged charges so unrelated
            # spending at the same merchant doesn't pollute the amounts.
            tagged_stats = _analyze_group(merchant_key, tagged_txs, cat_names)
            subscriptions.append(
                _build_item(merchant_key, tagged_stats, months, False, True, None, today,
                            nickname, linked_keys)
            )
        elif len(occurrences) >= MIN_OCCURRENCES or (
            cadence in _SPARSE_CADENCES and len(occurrences) >= MIN_OCCURRENCES_SPARSE
        ):
            if cadence is None:
                reason = "irregular_cadence"
            elif not amounts_ok:
                reason = "amount_varies"
            else:
                reason = "too_few_occurrences"
            candidates.append(
                SubscriptionCandidate(
                    merchant_key=merchant_key,
                    display_name=full.display_name,
                    nickname=nickname,
                    occurrence_count=len(occurrences),
                    last_charged=occurrences[-1][0].isoformat(),
                    median_amount=round(statistics.median([a for _, a in occurrences]), 2),
                    category_id=full.category_id,
                    category_name=full.category_name,
                    reason=reason,
                )
            )
        elif cadence is not None and amounts_ok:
            # Regular series that's simply too short (e.g. 2 monthly charges).
            candidates.append(
                SubscriptionCandidate(
                    merchant_key=merchant_key,
                    display_name=full.display_name,
                    nickname=nickname,
                    occurrence_count=len(occurrences),
                    last_charged=occurrences[-1][0].isoformat(),
                    median_amount=round(statistics.median([a for _, a in occurrences]), 2),
                    category_id=full.category_id,
                    category_name=full.category_name,
                    reason="too_few_occurrences",
                )
            )

    subscriptions.sort(key=lambda s: s.monthly_equivalent, reverse=True)
    dismissed.sort(key=lambda s: s.monthly_equivalent, reverse=True)
    candidates.sort(key=lambda c: c.occurrence_count, reverse=True)

    active = [s for s in subscriptions if s.status == "active"]
    return SubscriptionsReport(
        months=months,
        total_monthly=round(sum(s.monthly_equivalent for s in active), 2),
        total_annual=round(sum(s.annual_equivalent for s in active), 2),
        active_count=len(active),
        lapsed_count=len(subscriptions) - len(active),
        price_increase_count=sum(1 for s in subscriptions if s.price_increased),
        subscriptions=subscriptions,
        dismissed=dismissed,
        candidates=candidates,
    )


# ─── User overrides (nicknames and linked merchants) ─────────────────────────
#
# All of these mutate SubscriptionRule rows. A row is kept only while it
# carries something (rule, nickname, or alias_of); emptied rows are deleted
# so stale merchant keys don't accumulate.


def _is_empty_rule(row: SubscriptionRule) -> bool:
    return row.rule is None and row.nickname is None and row.alias_of is None


def set_nickname(
    db: Session, user_id: int, merchant_key: str, nickname: Optional[str]
) -> None:
    """Set or clear (nickname=None) the display nickname for a merchant."""
    row = (
        db.query(SubscriptionRule)
        .filter(
            SubscriptionRule.user_id == user_id,
            SubscriptionRule.merchant_key == merchant_key,
        )
        .first()
    )
    if row is None:
        if nickname is None:
            return
        db.add(SubscriptionRule(user_id=user_id, merchant_key=merchant_key, nickname=nickname))
    else:
        row.nickname = nickname
        if _is_empty_rule(row):
            db.delete(row)
    db.commit()


def link_merchants(
    db: Session, user_id: int, target_key: str, merchant_keys: list[str]
) -> None:
    """Link merchant keys into target_key so they report as one subscription.

    The target is resolved to its root first and any keys already aliased to
    a source are re-pointed, keeping links flat (never chained). A linked
    key's own include/exclude is cleared — the canonical key's rule governs
    the merged group.

    Raises ValueError when a key would be linked to itself.
    """
    rows = db.query(SubscriptionRule).filter(SubscriptionRule.user_id == user_id).all()
    by_key = {r.merchant_key: r for r in rows}
    alias_map = {r.merchant_key: r.alias_of for r in rows if r.alias_of}
    root = _resolve_alias(target_key, alias_map)

    sources = set(merchant_keys)
    if root in sources:
        raise ValueError("cannot link a merchant to itself")

    for key in sources:
        row = by_key.get(key)
        if row is None:
            row = SubscriptionRule(user_id=user_id, merchant_key=key)
            db.add(row)
            by_key[key] = row
        row.alias_of = root
        row.rule = None
        for other in rows:
            if other.alias_of == key:
                other.alias_of = root
    db.commit()


def unlink_merchant(db: Session, user_id: int, merchant_key: str) -> None:
    """Detach a merchant key from the subscription it was linked into."""
    row = (
        db.query(SubscriptionRule)
        .filter(
            SubscriptionRule.user_id == user_id,
            SubscriptionRule.merchant_key == merchant_key,
        )
        .first()
    )
    if row is None or row.alias_of is None:
        return
    row.alias_of = None
    if _is_empty_rule(row):
        db.delete(row)
    db.commit()


def remove_rule(db: Session, user_id: int, rule_id: int) -> bool:
    """Drop the include/exclude decision behind Untrack/Restore.

    The row itself survives when it also carries a nickname or link, so
    restoring a dismissed merchant doesn't wipe those. Returns False when
    no such rule exists for the user.
    """
    row = (
        db.query(SubscriptionRule)
        .filter(SubscriptionRule.id == rule_id, SubscriptionRule.user_id == user_id)
        .first()
    )
    if row is None:
        return False
    row.rule = None
    if _is_empty_rule(row):
        db.delete(row)
    db.commit()
    return True
