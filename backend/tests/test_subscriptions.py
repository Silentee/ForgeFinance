from datetime import date, timedelta

import pytest

from app.models import Account, Category, SubscriptionRule, Transaction, User
from app.models.enums import TransactionType
from app.services.subscriptions import (
    build_subscriptions_report,
    link_merchants,
    normalize_merchant,
    remove_rule,
    set_nickname,
    unlink_merchant,
)


def _setup(db):
    # Deliberately NOT named "Subscriptions": that name tags transactions as
    # explicit subscriptions (force-included), which most tests must avoid.
    acct = Account(name="Checking", account_type="checking")
    cat = Category(name="Streaming", is_income=False)
    user = User(username="t", password_hash="x")
    db.add_all([acct, cat, user])
    db.flush()
    return acct, cat, user


def _subs_category(db, name="Subscriptions"):
    """The category whose name marks transactions as tagged subscriptions."""
    cat = Category(name=name, is_income=False)
    db.add(cat)
    db.flush()
    return cat


def _tx(db, acct, cat, amount, tx_type, when, desc="Netflix", **flags):
    tx = Transaction(
        account_id=acct.id,
        category_id=cat.id if cat else None,
        date=when,
        amount=amount,
        transaction_type=tx_type,
        original_description=desc,
        **flags,
    )
    db.add(tx)
    return tx


def _days_ago(n: int) -> date:
    return date.today() - timedelta(days=n)


def test_monthly_detection(db):
    acct, subs, user = _setup(db)
    for i in range(6):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.cadence == "monthly"
    assert item.status == "active"
    assert item.amount == 15.99
    assert item.monthly_equivalent == 15.99
    assert item.annual_equivalent == round(15.99 * 12, 2)
    assert item.occurrence_count == 6
    assert item.category_name == "Streaming"
    assert item.next_expected == (date.today() + timedelta(days=30)).isoformat()
    assert report.total_monthly == 15.99
    assert report.active_count == 1


def test_annual_detection_two_occurrences(db):
    acct, subs, user = _setup(db)
    _tx(db, acct, subs, 119.0, TransactionType.DEBIT, _days_ago(375), desc="Amazon Prime")
    _tx(db, acct, subs, 119.0, TransactionType.DEBIT, _days_ago(10), desc="Amazon Prime")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.cadence == "annual"
    assert item.status == "active"
    assert item.monthly_equivalent == round(119.0 / 12, 2)


def test_minimum_occurrences(db):
    acct, subs, user = _setup(db)
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(40))
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(10))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert len(report.candidates) == 1
    assert report.candidates[0].reason == "too_few_occurrences"


def test_price_increase_flag(db):
    acct, subs, user = _setup(db)
    for i in range(4, 0, -1):
        _tx(db, acct, subs, 9.99, TransactionType.DEBIT, _days_ago(30 * i + 5))
    _tx(db, acct, subs, 12.99, TransactionType.DEBIT, _days_ago(5))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    item = report.subscriptions[0]
    assert item.price_increased is True
    assert item.amount == 12.99
    assert item.previous_amount == 9.99
    assert item.price_change_pct == 30.0
    assert report.price_increase_count == 1


def test_price_decrease_not_flagged(db):
    acct, subs, user = _setup(db)
    for i in range(4, 0, -1):
        _tx(db, acct, subs, 12.99, TransactionType.DEBIT, _days_ago(30 * i + 5))
    _tx(db, acct, subs, 9.99, TransactionType.DEBIT, _days_ago(5))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    item = report.subscriptions[0]
    assert item.price_increased is False
    assert item.price_change_pct is None


def test_lapsed_status(db):
    acct, subs, user = _setup(db)
    for i in range(5, 1, -1):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    item = report.subscriptions[0]
    assert item.status == "lapsed"
    # Lapsed subscriptions don't count toward recurring totals
    assert report.total_monthly == 0.0
    assert report.lapsed_count == 1
    assert report.active_count == 0


def test_amount_tolerance_rejects_variable_spend(db):
    acct, subs, user = _setup(db)
    for i, amount in enumerate([500.0, 15.0, 210.0, 10.0]):
        _tx(db, acct, subs, amount, TransactionType.DEBIT, _days_ago(30 * i + 5), desc="Costco")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert len(report.candidates) == 1
    assert report.candidates[0].reason == "amount_varies"


def test_exclude_rule_dismisses(db):
    acct, subs, user = _setup(db)
    for i in range(6):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    db.flush()
    key = normalize_merchant(db.query(Transaction).first())
    rule = SubscriptionRule(user_id=user.id, merchant_key=key, rule="exclude")
    db.add(rule)
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert report.total_monthly == 0.0
    assert len(report.dismissed) == 1
    assert report.dismissed[0].rule_id == rule.id


def test_include_rule_forces_irregular(db):
    acct, subs, user = _setup(db)
    # Gaps of 20, 45, and 70 days — no cadence bucket matches
    for days in (135, 115, 70, 0):
        _tx(db, acct, subs, 25.0, TransactionType.DEBIT, _days_ago(days), desc="Odd Charge")
    db.flush()
    key = normalize_merchant(db.query(Transaction).first())
    rule = SubscriptionRule(user_id=user.id, merchant_key=key, rule="include")
    db.add(rule)
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.cadence == "irregular"
    assert item.is_manual is True
    assert item.next_expected is None
    assert item.rule_id == rule.id
    # Without the include rule this merchant would only be a candidate
    assert all(c.merchant_key != key for c in report.candidates)


def test_normalize_merchant():
    def tx_with(desc):
        return Transaction(original_description=desc)

    key = normalize_merchant(tx_with("Netflix.com"))
    assert normalize_merchant(tx_with("NETFLIX.COM #12345")) == key
    assert normalize_merchant(tx_with("PAYPAL *NETFLIX")) == key
    # Short leading digits survive (they're part of the brand)
    assert "7" in normalize_merchant(tx_with("7-Eleven 3401"))
    # Store numbers don't fragment a merchant into separate keys
    assert normalize_merchant(tx_with("7-Eleven 3401")) == normalize_merchant(
        tx_with("7-Eleven 998")
    )


def test_filters_applied(db):
    acct, subs, user = _setup(db)
    for i in range(3):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i + 5))
    # None of these may create or extend the series
    _tx(db, acct, subs, 15.99, TransactionType.CREDIT, _days_ago(95))
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(125), is_transfer=True)
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(155), is_pending=True)
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(185), exclude_from_budget=True)
    # A merchant with only filtered rows never appears at all
    _tx(db, acct, subs, 9.99, TransactionType.DEBIT, _days_ago(35), desc="Ghost", is_pending=True)
    _tx(db, acct, subs, 9.99, TransactionType.DEBIT, _days_ago(5), desc="Ghost", is_pending=True)
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    assert report.subscriptions[0].occurrence_count == 3
    all_keys = [s.merchant_key for s in report.subscriptions] + [
        c.merchant_key for c in report.candidates
    ]
    assert "ghost" not in all_keys


# ── Tagged transactions (category named 'Subscriptions') ─────────────────────


def test_single_tagged_charge_included(db):
    acct, _, user = _setup(db)
    subs = _subs_category(db)
    _tx(db, acct, subs, 120.0, TransactionType.DEBIT, _days_ago(10), desc="One Off Box")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.is_tagged is True
    assert item.is_manual is False
    assert item.cadence == "irregular"
    assert item.occurrence_count == 1
    assert item.next_expected is None
    assert item.previous_amount is None
    assert item.monthly_equivalent == round(120.0 / 24, 2)
    assert item.category_id == subs.id
    assert item.category_name == "Subscriptions"
    assert report.candidates == []


def test_single_untagged_charge_still_skipped(db):
    acct, cat, user = _setup(db)
    _tx(db, acct, cat, 120.0, TransactionType.DEBIT, _days_ago(10), desc="One Off Box")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert report.candidates == []


def test_tag_category_name_case_insensitive(db):
    acct, _, user = _setup(db)
    subs = _subs_category(db, name="subscriptions")
    _tx(db, acct, subs, 9.99, TransactionType.DEBIT, _days_ago(10), desc="One Off Box")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    assert report.subscriptions[0].is_tagged is True


def test_tagged_subset_isolated_from_mixed_group(db):
    acct, cat, user = _setup(db)
    subs = _subs_category(db)
    # Wildly varying untagged spend at the same merchant defeats detection...
    for i, amount in enumerate([500.0, 15.0, 210.0, 10.0]):
        _tx(db, acct, cat, amount, TransactionType.DEBIT, _days_ago(30 * i + 5), desc="Amazon")
    # ...but explicitly tagged charges force it in, built from those alone.
    _tx(db, acct, subs, 14.99, TransactionType.DEBIT, _days_ago(40), desc="Amazon")
    _tx(db, acct, subs, 14.99, TransactionType.DEBIT, _days_ago(10), desc="Amazon")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.is_tagged is True
    assert item.occurrence_count == 2
    assert item.total_in_window == round(14.99 * 2, 2)
    assert item.category_id == subs.id
    assert report.candidates == []


def test_detected_group_keeps_full_stats_with_tag(db):
    acct, cat, user = _setup(db)
    subs = _subs_category(db)
    for i in range(5, 0, -1):
        _tx(db, acct, cat, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(0))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.is_tagged is True
    assert item.cadence == "monthly"
    # Detection passed, so the item keeps the full group's stats
    assert item.occurrence_count == 6
    assert item.category_id == cat.id


def test_exclude_rule_beats_tag(db):
    acct, _, user = _setup(db)
    subs = _subs_category(db)
    tx = _tx(db, acct, subs, 120.0, TransactionType.DEBIT, _days_ago(10), desc="One Off Box")
    db.flush()
    rule = SubscriptionRule(
        user_id=user.id, merchant_key=normalize_merchant(tx), rule="exclude"
    )
    db.add(rule)
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert len(report.dismissed) == 1
    assert report.dismissed[0].rule_id == rule.id
    assert report.dismissed[0].is_tagged is True


def test_tagged_only_mode(db):
    acct, cat, user = _setup(db)
    subs = _subs_category(db)
    for i in range(6):
        _tx(db, acct, cat, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    _tx(db, acct, subs, 120.0, TransactionType.DEBIT, _days_ago(10), desc="One Off Box")
    db.commit()

    full_report = build_subscriptions_report(db, user.id)
    assert {s.display_name for s in full_report.subscriptions} == {"Netflix", "One Off Box"}

    tagged_report = build_subscriptions_report(db, user.id, tagged_only=True)
    assert len(tagged_report.subscriptions) == 1
    item = tagged_report.subscriptions[0]
    assert item.display_name == "One Off Box"
    assert item.is_tagged is True
    assert tagged_report.candidates == []


def test_category_id_exposed(db):
    acct, cat, user = _setup(db)
    for i in range(6):
        _tx(db, acct, cat, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    # Irregular gaps -> lands in candidates
    for days in (135, 115, 70, 0):
        _tx(db, acct, cat, 25.0, TransactionType.DEBIT, _days_ago(days), desc="Odd Charge")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions[0].category_id == cat.id
    assert len(report.candidates) == 1
    assert report.candidates[0].category_id == cat.id
    assert report.candidates[0].category_name == "Streaming"


# ── Nicknames and linked merchants ────────────────────────────────────────────


def _drifted_merchant(db, acct, cat):
    """One monthly subscription whose descriptor changed mid-stream.

    Each key alone has only 2 charges (below MIN_OCCURRENCES); the combined
    series is a clean 30-day cadence. Returns (old_key, new_key).
    """
    old = _tx(db, acct, cat, 12.99, TransactionType.DEBIT, _days_ago(95), desc="Old Streaming Co")
    _tx(db, acct, cat, 12.99, TransactionType.DEBIT, _days_ago(65), desc="Old Streaming Co")
    new = _tx(db, acct, cat, 12.99, TransactionType.DEBIT, _days_ago(35), desc="New Streaming Co")
    _tx(db, acct, cat, 12.99, TransactionType.DEBIT, _days_ago(5), desc="New Streaming Co")
    db.flush()
    return normalize_merchant(old), normalize_merchant(new)


def test_link_merges_charge_series(db):
    acct, cat, user = _setup(db)
    old_key, new_key = _drifted_merchant(db, acct, cat)
    db.commit()

    # Unlinked: two short regular series, both stuck in candidates.
    report = build_subscriptions_report(db, user.id)
    assert report.subscriptions == []
    assert {c.merchant_key for c in report.candidates} == {old_key, new_key}

    link_merchants(db, user.id, new_key, [old_key])
    report = build_subscriptions_report(db, user.id)

    assert len(report.subscriptions) == 1
    item = report.subscriptions[0]
    assert item.merchant_key == new_key
    assert item.cadence == "monthly"
    assert item.occurrence_count == 4
    assert item.linked_keys == [old_key]
    # Detection passed on the merged series alone — no include rule involved.
    assert item.is_manual is False
    assert item.rule_id is None
    assert report.candidates == []


def test_unlink_restores_separate_rows(db):
    acct, cat, user = _setup(db)
    old_key, new_key = _drifted_merchant(db, acct, cat)
    db.commit()
    link_merchants(db, user.id, new_key, [old_key])

    unlink_merchant(db, user.id, old_key)
    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert {c.merchant_key for c in report.candidates} == {old_key, new_key}
    # The alias was the row's only content, so unlinking removed it entirely.
    assert db.query(SubscriptionRule).count() == 0


def test_exclude_on_canonical_dismisses_merged_group(db):
    acct, cat, user = _setup(db)
    old_key, new_key = _drifted_merchant(db, acct, cat)
    db.commit()
    link_merchants(db, user.id, new_key, [old_key])
    db.add(SubscriptionRule(user_id=user.id, merchant_key=new_key, rule="exclude"))
    db.commit()

    report = build_subscriptions_report(db, user.id)

    assert report.subscriptions == []
    assert len(report.dismissed) == 1
    assert report.dismissed[0].merchant_key == new_key
    assert report.dismissed[0].occurrence_count == 4


def test_link_chain_flattens(db):
    _, _, user = _setup(db)
    db.commit()

    link_merchants(db, user.id, "b", ["a"])
    link_merchants(db, user.id, "c", ["b"])

    rows = {r.merchant_key: r for r in db.query(SubscriptionRule).all()}
    assert rows["a"].alias_of == "c"
    assert rows["b"].alias_of == "c"
    assert "c" not in rows or rows["c"].alias_of is None


def test_link_to_self_rejected(db):
    _, _, user = _setup(db)
    db.commit()

    with pytest.raises(ValueError):
        link_merchants(db, user.id, "netflix", ["netflix"])
    # Also rejected when the target resolves into one of the sources.
    link_merchants(db, user.id, "b", ["a"])
    with pytest.raises(ValueError):
        link_merchants(db, user.id, "a", ["b"])


def test_link_clears_source_rule(db):
    acct, cat, user = _setup(db)
    old_key, new_key = _drifted_merchant(db, acct, cat)
    db.add(SubscriptionRule(user_id=user.id, merchant_key=old_key, rule="include"))
    db.commit()

    link_merchants(db, user.id, new_key, [old_key])

    row = db.query(SubscriptionRule).filter_by(merchant_key=old_key).one()
    assert row.rule is None
    assert row.alias_of == new_key


def test_nickname_overrides_nothing_but_display(db):
    acct, subs, user = _setup(db)
    for i in range(6):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    db.flush()
    key = normalize_merchant(db.query(Transaction).first())
    set_nickname(db, user.id, key, "Family Netflix")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    item = report.subscriptions[0]
    assert item.nickname == "Family Netflix"
    assert item.display_name == "Netflix"  # derived name is untouched
    # A nickname-only row is not an include/exclude decision.
    assert item.is_manual is False
    assert item.rule_id is None

    # Clearing the nickname removes the now-empty row.
    set_nickname(db, user.id, key, None)
    assert db.query(SubscriptionRule).count() == 0
    report = build_subscriptions_report(db, user.id)
    assert report.subscriptions[0].nickname is None


def test_nickname_shown_on_candidates(db):
    acct, cat, user = _setup(db)
    old_key, _ = _drifted_merchant(db, acct, cat)
    set_nickname(db, user.id, old_key, "Streaming Thing")
    db.commit()

    report = build_subscriptions_report(db, user.id)

    by_key = {c.merchant_key: c for c in report.candidates}
    assert by_key[old_key].nickname == "Streaming Thing"


def test_remove_rule_preserves_nickname_and_link(db):
    acct, subs, user = _setup(db)
    for i in range(6):
        _tx(db, acct, subs, 15.99, TransactionType.DEBIT, _days_ago(30 * i))
    db.flush()
    key = normalize_merchant(db.query(Transaction).first())
    rule = SubscriptionRule(user_id=user.id, merchant_key=key, rule="exclude", nickname="Mine")
    db.add(rule)
    db.commit()

    # Restore (remove the exclude) keeps the nickname-bearing row alive.
    assert remove_rule(db, user.id, rule.id) is True
    row = db.query(SubscriptionRule).filter_by(merchant_key=key).one()
    assert row.rule is None
    assert row.nickname == "Mine"

    report = build_subscriptions_report(db, user.id)
    assert report.dismissed == []
    assert report.subscriptions[0].nickname == "Mine"


def test_remove_rule_deletes_bare_row(db):
    _, _, user = _setup(db)
    rule = SubscriptionRule(user_id=user.id, merchant_key="spotify", rule="include")
    db.add(rule)
    db.commit()

    assert remove_rule(db, user.id, rule.id) is True
    assert db.query(SubscriptionRule).count() == 0
    assert remove_rule(db, user.id, 9999) is False
