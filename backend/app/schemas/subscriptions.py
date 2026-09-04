"""
Pydantic schemas for the subscription report and its per-merchant
override rules (include/exclude, nicknames, linked merchant keys, forced
cadence/status, and manually entered subscriptions).
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator

Cadence = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual", "irregular"]
# Settable as an override; "irregular" is only ever derived, never forced.
CadenceOverride = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"]
# A pinned status. 'inactive' reports as "lapsed" — it drops out of the
# active totals exactly like a subscription that stopped being charged.
StatusOverride = Literal["active", "inactive"]


class LinkedMerchantRead(BaseModel):
    key: str                             # normalized merchant key
    display_name: str                    # most-common raw name for that key


class SubscriptionItem(BaseModel):
    merchant_key: str
    display_name: str                    # derived most-common raw name
    nickname: Optional[str] = None       # user-chosen name; display this when set
    linked_merchants: list[LinkedMerchantRead] = []  # merchants merged into this row
    cadence: Cadence
    cadence_override: Optional[CadenceOverride] = None  # set when cadence was user-forced
    status: Literal["active", "lapsed"]
    status_override: Optional[StatusOverride] = None    # set when status was user-pinned
    amount: float                        # latest charge
    previous_amount: Optional[float] = None
    price_increased: bool = False
    price_increased_on: Optional[str] = None  # ISO date the current price first appeared
    first_charged: Optional[str] = None  # ISO dates; None on a manual entry with no charges
    last_charged: Optional[str] = None
    next_expected: Optional[str] = None
    occurrence_count: int
    monthly_equivalent: float
    annual_equivalent: float
    total_in_window: float
    category_id: Optional[int] = None    # dominant category across the group
    category_name: Optional[str] = None
    is_manual: bool = False              # forced in by an 'include' rule
    is_manual_entry: bool = False        # user-declared subscription, not a detected merchant
    manual_amount: Optional[float] = None    # manual-entry cost, used while no charges are linked
    manual_start_date: Optional[str] = None  # manual-entry billing anchor (ISO date)
    is_tagged: bool = False              # has transactions categorized as 'Subscriptions'
    rule_id: Optional[int] = None        # set when an include/exclude rule exists
    has_duplicates: bool = False         # charged more often than the cadence implies
    duplicate_periods: list[str] = []    # periods with 2+ charges ("2026-05", "2026-Q2", ISO dates)
    recent_dates: list[str] = []         # last <=12 occurrences, oldest -> newest
    recent_amounts: list[float] = []


class SubscriptionCandidate(BaseModel):
    """A merchant that looks recurring-ish but failed the detection criteria.
    The UI offers 'Track' to promote it via an include rule."""
    merchant_key: str
    display_name: str
    nickname: Optional[str] = None
    occurrence_count: int
    last_charged: str
    median_amount: float
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    reason: Literal["irregular_cadence", "amount_varies", "too_few_occurrences"]


class SubscriptionsReport(BaseModel):
    months: int
    total_monthly: float                 # active subscriptions only
    total_annual: float
    active_count: int
    lapsed_count: int                    # includes subscriptions pinned inactive
    price_increase_count: int
    subscriptions: list[SubscriptionItem]
    dismissed: list[SubscriptionItem]
    candidates: list[SubscriptionCandidate]


def _require_merchant_key(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("merchant_key must not be empty")
    return v


def _require_positive_amount(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    if v <= 0:
        raise ValueError("amount must be greater than zero")
    return round(v, 2)


class SubscriptionRuleUpsert(BaseModel):
    merchant_key: str
    rule: Literal["include", "exclude"]

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)


class SubscriptionNicknameUpsert(BaseModel):
    merchant_key: str
    nickname: Optional[str] = None       # None/blank clears the nickname

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)

    @field_validator("nickname")
    @classmethod
    def blank_nickname_clears(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class SubscriptionLinkRequest(BaseModel):
    target_key: str                      # canonical merchant to merge into
    merchant_keys: list[str]             # keys to link into target_key

    target_key_not_empty = field_validator("target_key")(_require_merchant_key)

    @field_validator("merchant_keys")
    @classmethod
    def keys_not_empty(cls, v: list[str]) -> list[str]:
        v = [_require_merchant_key(k) for k in v]
        if not v:
            raise ValueError("merchant_keys must not be empty")
        return v

    @model_validator(mode="after")
    def target_not_in_sources(self) -> "SubscriptionLinkRequest":
        if self.target_key in self.merchant_keys:
            raise ValueError("cannot link a merchant to itself")
        return self


class SubscriptionUnlinkRequest(BaseModel):
    merchant_key: str

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)


class SubscriptionCadenceUpsert(BaseModel):
    merchant_key: str
    cadence: Optional[CadenceOverride] = None  # None clears the override

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)


class SubscriptionStatusUpsert(BaseModel):
    merchant_key: str
    status: Optional[StatusOverride] = None  # None returns the row to auto-detection

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)


class ManualSubscriptionCreate(BaseModel):
    """Create a manually tracked subscription.

    The row is always its own canonical 'manual:<hex>' merchant key, so it
    keeps a stable identity even when every attached merchant is later
    unlinked. Any merchant_keys picked off transactions are linked into it.

    amount and cadence are required when no merchant is attached — with no
    charges to measure, they are the only source for the report's math.
    """
    name: str
    merchant_keys: list[str] = []
    amount: Optional[float] = None
    cadence: Optional[CadenceOverride] = None
    start_date: Optional[date] = None

    amount_positive = field_validator("amount")(_require_positive_amount)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v[:120]  # nickname column width

    @field_validator("merchant_keys")
    @classmethod
    def keys_valid(cls, v: list[str]) -> list[str]:
        return [_require_merchant_key(k) for k in v]

    @model_validator(mode="after")
    def detail_required_without_merchants(self) -> "ManualSubscriptionCreate":
        if not self.merchant_keys and (self.amount is None or self.cadence is None):
            raise ValueError("amount and cadence are required when no transaction is attached")
        return self


class ManualEntryUpdate(BaseModel):
    """Replace a manual entry's amount and billing anchor.

    Both fields always apply, so omitting one clears it.
    """
    merchant_key: str
    amount: Optional[float] = None
    start_date: Optional[date] = None

    merchant_key_not_empty = field_validator("merchant_key")(_require_merchant_key)
    amount_positive = field_validator("amount")(_require_positive_amount)


class MerchantKeyResolveRequest(BaseModel):
    transaction_ids: list[int]

    @field_validator("transaction_ids")
    @classmethod
    def ids_not_empty(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("transaction_ids must not be empty")
        return v


class MerchantKeyResolution(BaseModel):
    transaction_id: int
    merchant_key: str


class SubscriptionRuleRead(BaseModel):
    id: int
    merchant_key: str
    rule: Optional[Literal["include", "exclude"]] = None
    nickname: Optional[str] = None
    alias_of: Optional[str] = None
    cadence_override: Optional[CadenceOverride] = None
    status_override: Optional[StatusOverride] = None
    manual_amount: Optional[float] = None
    manual_start_date: Optional[date] = None

    model_config = {"from_attributes": True}
