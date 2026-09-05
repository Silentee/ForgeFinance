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
fails (down to a single one-off charge).

A manual entry is a subscription the user declared outright rather than one
found in the data: a rule row on a synthetic 'manual:<hex>' key carrying its
own amount, cadence, and start date. It reports even with no charges at all,
and real merchants attach to it through the ordinary alias_of link.

Detection only ever yields one of the builtin cadences, but the user may
override a merchant with a custom interval ('every:<n>:<weeks|months>') the
builtins can't express — see cadence_nominal_days.
"""

import re
import statistics
import uuid
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import NamedTuple, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Category, SubscriptionRule, Transaction
from app.models.enums import TransactionType
from app.schemas.subscriptions import (
    LinkedMerchantRead,
    SubscriptionCandidate,
    SubscriptionItem,
    SubscriptionsReport,
    canonical_cadence,
    parse_custom_cadence,
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

# Average calendar month, so a custom "every 2 months" nominally means 60.875
# days — measured against the same 365.25-day year as the table above.
DAYS_PER_MONTH = 365.25 / 12


def cadence_nominal_days(cadence: Optional[str]) -> Optional[float]:
    """Days between charges for a builtin or a custom cadence.

    None when the cadence carries no interval at all: absent, 'irregular', or
    unrecognized.
    """
    if cadence in CADENCE_BUCKETS:
        return 365.25 / CADENCE_BUCKETS[cadence][2]
    parsed = parse_custom_cadence(cadence)
    if parsed is None:
        return None
    interval, unit = parsed
    return interval * (7.0 if unit == "weeks" else DAYS_PER_MONTH)


def cadence_periods_per_year(cadence: Optional[str]) -> Optional[float]:
    """Charges per year, or None for a cadence with no interval.

    Builtins return their exact tabled value rather than a round trip through
    nominal days: 365.25 / (365.25 / 52) is not guaranteed to be exactly 52.0,
    and the existing totals depend on it being so.
    """
    if cadence in CADENCE_BUCKETS:
        return float(CADENCE_BUCKETS[cadence][2])
    days = cadence_nominal_days(cadence)
    return None if days is None else 365.25 / days


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

# Manual entries live on synthetic keys. normalize_merchant strips every
# character outside [a-z0-9& ], so no transaction can ever produce a key
# containing ':' — the prefix is an unambiguous marker.
MANUAL_KEY_PREFIX = "manual:"


def is_manual_entry(merchant_key: str) -> bool:
    """True for a user-declared subscription rather than a detected merchant."""
    return merchant_key.startswith(MANUAL_KEY_PREFIX)


def new_manual_key() -> str:
    return f"{MANUAL_KEY_PREFIX}{uuid.uuid4().hex[:12]}"


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
) -> list[Transaction]:
    """Debits eligible for recurrence detection.

    Unlike budget reports, is_annualized rows are included: annualized is a
    budget-spreading flag and an annualized annual charge is exactly the kind
    of subscription this report exists to surface.
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


def _price_increase_date(dates: list[date], amounts: list[float]) -> date:
    """Date the current price took effect.

    Walks back from the latest charge across every occurrence still at that
    price, using the same 2% band as the increase test so a charge differing
    by a rounding cent isn't mistaken for the old price.
    """
    current = amounts[-1]
    i = len(amounts) - 1
    while i > 0 and abs(amounts[i - 1] - current) <= max(0.02 * current, 0.01):
        i -= 1
    return dates[i]


class _GroupStats(NamedTuple):
    occurrences: list[tuple[date, float]]
    display_name: str
    category_id: Optional[int]
    category_name: Optional[str]
    cadence: Optional[str]
    median_interval: float
    amounts_ok: bool
    # Raw charge count per date — _collapse_occurrences sums same-day
    # charges into one occurrence, but duplicate detection needs them.
    day_counts: dict[date, int]


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
        dict(Counter(tx.date for tx in txs)),
    )


# Calendar-period keys for duplicate detection: a cadence of one-per-period
# means two charges inside the same period are a likely duplicate.
_PERIOD_KEYS = {
    "monthly": lambda d: f"{d.year}-{d.month:02d}",
    "quarterly": lambda d: f"{d.year}-Q{(d.month - 1) // 3 + 1}",
    "semiannual": lambda d: f"{d.year}-H{1 if d.month <= 6 else 2}",
    "annual": lambda d: str(d.year),
}


def _find_duplicates(
    dates: list[date],
    day_counts: dict[date, int],
    cadence: Optional[str],
) -> tuple[bool, list[str]]:
    """Flag charges arriving more often than the cadence implies.

    Monthly and slower bucket by calendar period (a monthly charge drifting
    across a month boundary can false-positive — acceptable for a
    warning-only signal). Weekly, biweekly, and custom intervals flag gaps
    under half the nominal interval, since calendar weeks don't align with
    billing weeks and a custom interval has no calendar period at all.
    Warning only — never changes totals or detection status.
    """
    nominal = cadence_nominal_days(cadence)
    if nominal is None:
        return False, []

    if cadence in _PERIOD_KEYS:
        period_key = _PERIOD_KEYS[cadence]
        buckets: Counter[str] = Counter()
        for d in dates:
            buckets[period_key(d)] += day_counts.get(d, 1)
        periods = sorted(p for p, n in buckets.items() if n >= 2)
        return bool(periods), periods

    # weekly / biweekly / any custom interval
    flagged = {d for d in dates if day_counts.get(d, 1) >= 2}
    for a, b in zip(dates, dates[1:]):
        if (b - a).days < nominal / 2:
            flagged.add(b)
    return bool(flagged), sorted(d.isoformat() for d in flagged)


def _build_item(
    merchant_key: str,
    g: _GroupStats,
    months: int,
    is_manual: bool,
    is_tagged: bool,
    rule_id: Optional[int],
    today: date,
    nickname: Optional[str] = None,
    linked_merchants: Optional[list[LinkedMerchantRead]] = None,
    cadence_override: Optional[str] = None,
    status_override: Optional[str] = None,
    category_override_id: Optional[int] = None,
    manual_amount: Optional[float] = None,
    manual_start_date: Optional[date] = None,
    cat_names: Optional[dict[int, str]] = None,
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
    price_increased_on = _price_increase_date(dates, amounts) if price_increased else None

    if cadence_override is not None:
        # User-forced cadence: all interval math uses the nominal cadence
        # length, not the observed median (which reflects the wrong cadence).
        cadence = cadence_override
        periods_per_year = cadence_periods_per_year(cadence)
        nominal_interval = cadence_nominal_days(cadence)
        monthly_equivalent = round(amount * periods_per_year / 12.0, 2)
        next_expected = last_charged + timedelta(days=round(nominal_interval))
        lapsed_after_days = LAPSED_INTERVAL_FACTOR * nominal_interval
    elif cadence is not None:
        # Detection only ever yields a builtin cadence.
        periods_per_year = CADENCE_BUCKETS[cadence][2]
        monthly_equivalent = round(amount * periods_per_year / 12.0, 2)
        next_expected = last_charged + timedelta(days=round(median_interval))
        lapsed_after_days = LAPSED_INTERVAL_FACTOR * median_interval
    else:
        cadence = "irregular"
        monthly_equivalent = round(sum(amounts) / months, 2)
        next_expected = None
        lapsed_after_days = max(90.0, 2 * median_interval)

    # A pinned status wins outright; 'inactive' reports as lapsed so it drops
    # out of the active totals exactly like a subscription that stopped billing.
    if status_override is not None:
        status = "active" if status_override == "active" else "lapsed"
    else:
        status = "lapsed" if (today - last_charged).days > lapsed_after_days else "active"

    has_duplicates, duplicate_periods = _find_duplicates(
        dates, g.day_counts, cadence if cadence != "irregular" else None
    )

    # A pinned category wins over the charges' dominant one, so a manual
    # entry keeps the category the user chose even after charges attach.
    if category_override_id is not None:
        category_id = category_override_id
        category_name = (cat_names or {}).get(category_override_id)
    else:
        category_id, category_name = g.category_id, g.category_name

    return SubscriptionItem(
        merchant_key=merchant_key,
        display_name=g.display_name,
        nickname=nickname,
        linked_merchants=linked_merchants or [],
        cadence=cadence,
        cadence_override=cadence_override,
        status=status,
        status_override=status_override,
        amount=round(amount, 2),
        previous_amount=previous_amount,
        price_increased=price_increased,
        price_increased_on=price_increased_on.isoformat() if price_increased_on else None,
        first_charged=dates[0].isoformat(),
        last_charged=last_charged.isoformat(),
        next_expected=next_expected.isoformat() if next_expected else None,
        occurrence_count=len(g.occurrences),
        monthly_equivalent=monthly_equivalent,
        annual_equivalent=round(monthly_equivalent * 12, 2),
        total_in_window=round(sum(amounts), 2),
        category_id=category_id,
        category_name=category_name,
        category_override_id=category_override_id,
        is_manual=is_manual,
        is_manual_entry=is_manual_entry(merchant_key),
        manual_amount=manual_amount,
        manual_start_date=manual_start_date.isoformat() if manual_start_date else None,
        is_tagged=is_tagged,
        rule_id=rule_id,
        has_duplicates=has_duplicates,
        duplicate_periods=duplicate_periods,
        recent_dates=[d.isoformat() for d in dates[-12:]],
        recent_amounts=[round(a, 2) for a in amounts[-12:]],
    )


def _roll_forward(start: date, cadence: str, today: date) -> date:
    """First occurrence of a cadence anchored at `start` that is not past.

    Callers check cadence_periods_per_year first, so the interval resolves.
    """
    step = max(1, round(cadence_nominal_days(cadence)))
    if start >= today:
        return start
    periods = -((start - today).days // step)  # ceil division on a negative gap
    return start + timedelta(days=step * periods)


def _build_manual_item(
    rule: SubscriptionRule, today: date, cat_names: dict[int, str]
) -> SubscriptionItem:
    """Report row for a manual entry with no charges in the window.

    Everything comes from what the user typed. The `or` fallbacks keep a
    half-filled entry (one whose amount or cadence was cleared) visible and
    repairable instead of silently dropping it from the report.
    """
    amount = round(float(rule.manual_amount), 2) if rule.manual_amount is not None else 0.0
    cadence = rule.cadence_override or "irregular"
    periods_per_year = cadence_periods_per_year(cadence)
    monthly_equivalent = (
        round(amount * periods_per_year / 12.0, 2) if periods_per_year is not None else 0.0
    )
    next_expected = (
        _roll_forward(rule.manual_start_date, cadence, today)
        if rule.manual_start_date is not None and periods_per_year is not None
        else None
    )

    return SubscriptionItem(
        merchant_key=rule.merchant_key,
        display_name=rule.nickname or rule.merchant_key,
        nickname=rule.nickname,
        linked_merchants=[],
        cadence=cadence,
        cadence_override=rule.cadence_override,
        # Nothing has been charged, so there is no lapse to detect: a manual
        # entry is active until the user says otherwise.
        status="lapsed" if rule.status_override == "inactive" else "active",
        status_override=rule.status_override,
        amount=amount,
        first_charged=None,
        last_charged=None,
        next_expected=next_expected.isoformat() if next_expected else None,
        occurrence_count=0,
        monthly_equivalent=monthly_equivalent,
        annual_equivalent=round(monthly_equivalent * 12, 2),
        total_in_window=0.0,
        # Nothing was charged, so the pinned category is the only one there is.
        category_id=rule.category_id,
        category_name=cat_names.get(rule.category_id) if rule.category_id else None,
        category_override_id=rule.category_id,
        is_manual=True,
        is_manual_entry=True,
        manual_amount=amount if rule.manual_amount is not None else None,
        manual_start_date=(
            rule.manual_start_date.isoformat() if rule.manual_start_date else None
        ),
        # A manual entry's row *is* the subscription, so the UI always needs
        # its id — unlike an override row, which only has one while it holds
        # an include/exclude decision.
        rule_id=rule.id,
    )


def build_subscriptions_report(
    db: Session,
    user_id: int,
    months: int = 24,
    account_ids: Optional[list[int]] = None,
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

    txs = _get_candidate_transactions(db, date_from, account_ids)

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

    # Raw labels are tracked per pre-alias key so each linked child can be
    # shown under its own most-common merchant name in the edit dialog.
    groups: dict[str, list[Transaction]] = defaultdict(list)
    raw_labels: dict[str, Counter] = defaultdict(Counter)
    for tx in txs:
        original = normalize_merchant(tx)
        groups[_resolve_alias(original, alias_map)].append(tx)
        raw_labels[original][
            (tx.merchant_name or tx.description or tx.original_description or "").strip()
        ] += 1

    def _child_display(key: str) -> str:
        # A linked key may have no transactions in the window; fall back to
        # its own nickname, then the raw key.
        if raw_labels.get(key):
            return raw_labels[key].most_common(1)[0][0] or key
        child_rule = rules.get(key)
        return (child_rule.nickname if child_rule else None) or key

    # One Category lookup covers every group's dominant-category resolution
    # and every rule's pinned category, including manual entries with no
    # charges (whose id appears nowhere in txs).
    cat_ids = {tx.category_id for tx in txs if tx.category_id is not None}
    cat_ids |= {r.category_id for r in rules.values() if r.category_id is not None}
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
        cadence_override = rule.cadence_override if rule is not None else None
        # A manual entry's row is the subscription itself, so its id travels
        # with the item even on the paths where a plain override row has none.
        row_id = (
            rule.id if rule is not None and is_manual_entry(merchant_key) else None
        )
        # Bundled because every _build_item call below passes all the
        # user-set fields through unchanged.
        overrides = dict(
            nickname=nickname,
            cadence_override=cadence_override,
            status_override=rule.status_override if rule is not None else None,
            category_override_id=rule.category_id if rule is not None else None,
            cat_names=cat_names,
            manual_amount=(
                round(float(rule.manual_amount), 2)
                if rule is not None and rule.manual_amount is not None
                else None
            ),
            manual_start_date=rule.manual_start_date if rule is not None else None,
        )
        linked_merchants = [
            LinkedMerchantRead(key=k, display_name=_child_display(k))
            for k in sorted(linked_children.get(merchant_key, []))
        ]
        tagged_txs = [tx for tx in group_txs if tx.category_id in tagged_cat_ids]
        has_tagged = bool(tagged_txs)

        full = _analyze_group(merchant_key, group_txs, cat_names)
        occurrences = full.occurrences
        # A lone charge is normally invisible to detection, but one the user
        # tagged or manually included (e.g. a subscription's first charge)
        # must still surface.
        has_include = rule is not None and rule.rule == "include"
        if len(occurrences) < 2 and not has_tagged and not has_include:
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
                                linked_merchants=linked_merchants, **overrides)
                )
            elif has_tagged:
                # Tagged but undetected: still restorable from the dismissed list.
                tagged_stats = _analyze_group(merchant_key, tagged_txs, cat_names)
                dismissed.append(
                    _build_item(merchant_key, tagged_stats, months, False, True, rule.id, today,
                                linked_merchants=linked_merchants, **overrides)
                )
            continue

        if rule is not None and rule.rule == "include":
            subscriptions.append(
                _build_item(merchant_key, full, months, True, has_tagged, rule.id, today,
                            linked_merchants=linked_merchants, **overrides)
            )
            continue

        if detected:
            subscriptions.append(
                _build_item(merchant_key, full, months, False, has_tagged, row_id, today,
                            linked_merchants=linked_merchants, **overrides)
            )
        elif has_tagged:
            # Failed detection but the user tagged charges here: force the
            # merchant in, built from only the tagged charges so unrelated
            # spending at the same merchant doesn't pollute the amounts.
            tagged_stats = _analyze_group(merchant_key, tagged_txs, cat_names)
            subscriptions.append(
                _build_item(merchant_key, tagged_stats, months, False, True, row_id, today,
                            linked_merchants=linked_merchants, **overrides)
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

    # Manual entries with no charges in the window never appear above — the
    # loop only walks groups built from transactions — so they're emitted
    # from what the user typed. One that did collect charges (through a
    # linked merchant) already went through the normal path, since its
    # include rule carries it past the minimum-occurrence guard.
    for key, rule in rules.items():
        if is_manual_entry(key) and key not in groups:
            target = dismissed if rule.rule == "exclude" else subscriptions
            target.append(_build_manual_item(rule, today, cat_names))

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


# ─── User overrides (nicknames, cadence, and linked merchants) ───────────────
#
# All of these mutate SubscriptionRule rows. A row is kept only while it
# carries something (a rule, nickname, alias, cadence, status, category, or
# manual detail); emptied rows are deleted so stale merchant keys don't
# accumulate.


def _is_empty_rule(row: SubscriptionRule) -> bool:
    # Manual entries are never empty: the row *is* the subscription, so it
    # survives even after its name, cadence, and amount are all cleared.
    if is_manual_entry(row.merchant_key):
        return False
    return (
        row.rule is None
        and row.nickname is None
        and row.alias_of is None
        and row.cadence_override is None
        and row.status_override is None
        and row.category_id is None
        and row.manual_amount is None
        and row.manual_start_date is None
    )


def _get_rule(db: Session, user_id: int, merchant_key: str) -> Optional[SubscriptionRule]:
    return (
        db.query(SubscriptionRule)
        .filter(
            SubscriptionRule.user_id == user_id,
            SubscriptionRule.merchant_key == merchant_key,
        )
        .first()
    )


def set_nickname(
    db: Session, user_id: int, merchant_key: str, nickname: Optional[str]
) -> None:
    """Set or clear (nickname=None) the display nickname for a merchant."""
    row = _get_rule(db, user_id, merchant_key)
    if row is None:
        if nickname is None:
            return
        db.add(SubscriptionRule(user_id=user_id, merchant_key=merchant_key, nickname=nickname))
    else:
        row.nickname = nickname
        if _is_empty_rule(row):
            db.delete(row)
    db.commit()


def set_cadence_override(
    db: Session, user_id: int, merchant_key: str, cadence: Optional[str]
) -> None:
    """Set or clear (cadence=None) the forced billing cadence for a merchant.

    Accepts a builtin cadence name or a custom 'every:<n>:<weeks|months>'.

    Raises ValueError when clearing the cadence on a manual entry — it has
    no charge series to infer one from — or when the cadence is unusable.
    """
    if cadence is None and is_manual_entry(merchant_key):
        raise ValueError("a manually added subscription needs a cadence")

    # 'every:1:months' and 'monthly' are the same interval; store one spelling.
    cadence = canonical_cadence(cadence)
    if cadence is not None and cadence_nominal_days(cadence) is None:
        raise ValueError(f"unusable cadence: {cadence!r}")

    row = _get_rule(db, user_id, merchant_key)
    if row is None:
        if cadence is None:
            return
        db.add(SubscriptionRule(user_id=user_id, merchant_key=merchant_key, cadence_override=cadence))
    else:
        row.cadence_override = cadence
        if _is_empty_rule(row):
            db.delete(row)
    db.commit()


def set_status_override(
    db: Session, user_id: int, merchant_key: str, status: Optional[str]
) -> None:
    """Pin a merchant's status, or clear it (status=None) back to detection."""
    row = _get_rule(db, user_id, merchant_key)
    if row is None:
        if status is None:
            return
        db.add(SubscriptionRule(user_id=user_id, merchant_key=merchant_key, status_override=status))
    else:
        row.status_override = status
        if _is_empty_rule(row):
            db.delete(row)
    db.commit()


def _require_category(db: Session, category_id: Optional[int]) -> Optional[int]:
    """Reject a category id that doesn't exist; None (clear it) always passes."""
    if category_id is not None and db.get(Category, category_id) is None:
        raise ValueError("unknown category")
    return category_id


def set_category_override(
    db: Session, user_id: int, merchant_key: str, category_id: Optional[int]
) -> None:
    """Pin the category a merchant reports under, or clear it (category_id=None).

    Raises ValueError when the category does not exist.
    """
    _require_category(db, category_id)
    row = _get_rule(db, user_id, merchant_key)
    if row is None:
        if category_id is None:
            return
        db.add(SubscriptionRule(user_id=user_id, merchant_key=merchant_key, category_id=category_id))
    else:
        row.category_id = category_id
        if _is_empty_rule(row):
            db.delete(row)
    db.commit()


def create_manual_entry(
    db: Session,
    user_id: int,
    name: str,
    amount: Optional[float] = None,
    cadence: Optional[str] = None,
    start_date: Optional[date] = None,
    merchant_keys: Optional[list[str]] = None,
    category_id: Optional[int] = None,
) -> SubscriptionRule:
    """Create a manually tracked subscription.

    The row always owns a fresh synthetic merchant key, so the subscription
    keeps a stable identity no matter which merchants come and go: every
    key in merchant_keys is linked into it (which also clears each key's own
    include/exclude rule) and can later be unlinked without destroying it.

    amount/cadence/start_date are what the report falls back to while no
    charges are attached; once they are, real charge data takes over.
    category_id is the exception: it is pinned, so it keeps winning over the
    attached charges' own category.

    Raises ValueError when category_id names a category that doesn't exist.
    """
    row = SubscriptionRule(
        user_id=user_id,
        merchant_key=new_manual_key(),
        rule="include",
        nickname=name,
        cadence_override=canonical_cadence(cadence),
        category_id=_require_category(db, category_id),
        manual_amount=amount,
        manual_start_date=start_date,
    )
    db.add(row)
    # Committed before linking so link_merchants resolves the new key to
    # itself as the root.
    db.commit()

    deduped: list[str] = []
    for key in merchant_keys or []:
        if key not in deduped:
            deduped.append(key)
    if deduped:
        link_merchants(db, user_id, row.merchant_key, deduped)
    db.refresh(row)
    return row


def update_manual_entry(
    db: Session,
    user_id: int,
    merchant_key: str,
    amount: Optional[float],
    start_date: Optional[date],
) -> bool:
    """Replace a manual entry's amount and billing anchor.

    Both fields are replaced outright, so passing None clears one. Returns
    False when no such manual entry exists for the user.
    """
    if not is_manual_entry(merchant_key):
        raise ValueError("not a manually added subscription")
    row = _get_rule(db, user_id, merchant_key)
    if row is None:
        return False
    row.manual_amount = amount
    row.manual_start_date = start_date
    db.commit()
    return True


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
    row = _get_rule(db, user_id, merchant_key)
    if row is None or row.alias_of is None:
        return
    row.alias_of = None
    if _is_empty_rule(row):
        db.delete(row)
    db.commit()


def remove_rule(db: Session, user_id: int, rule_id: int) -> bool:
    """Drop the include/exclude decision behind Untrack/Restore.

    The row itself survives when it also carries a nickname or link, so
    restoring a dismissed merchant doesn't wipe those. A manual entry always
    survives (see _is_empty_rule) — deleting one is delete_manual_entry.

    Returns False when no such rule exists for the user.
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


def delete_manual_entry(db: Session, user_id: int, rule_id: int) -> bool:
    """Delete a manual entry outright.

    Unlike a detected merchant there is nothing behind it to fall back to,
    so the row goes. Its attached merchants are detached first — an alias
    pointing at a deleted key would strand their charges under a merchant
    that no longer exists — and return to ordinary detection.

    Returns False when the id isn't a manual entry belonging to the user.
    """
    row = (
        db.query(SubscriptionRule)
        .filter(SubscriptionRule.id == rule_id, SubscriptionRule.user_id == user_id)
        .first()
    )
    if row is None or not is_manual_entry(row.merchant_key):
        return False

    children = (
        db.query(SubscriptionRule)
        .filter(
            SubscriptionRule.user_id == user_id,
            SubscriptionRule.alias_of == row.merchant_key,
        )
        .all()
    )
    for child in children:
        child.alias_of = None
        if _is_empty_rule(child):
            db.delete(child)
    db.delete(row)
    db.commit()
    return True
