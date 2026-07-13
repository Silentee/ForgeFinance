"""
Pydantic schemas for the subscription report and its per-merchant
override rules (include/exclude, nicknames, and linked merchant keys).
"""

from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator

Cadence = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual", "irregular"]
# Settable as an override; "irregular" is only ever derived, never forced.
CadenceOverride = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual"]


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
    amount: float                        # latest charge
    previous_amount: Optional[float] = None
    price_increased: bool = False
    price_change_pct: Optional[float] = None
    first_charged: str                   # ISO dates
    last_charged: str
    next_expected: Optional[str] = None
    occurrence_count: int
    monthly_equivalent: float
    annual_equivalent: float
    total_in_window: float
    category_id: Optional[int] = None    # dominant category across the group
    category_name: Optional[str] = None
    is_manual: bool = False              # forced in by an 'include' rule
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
    lapsed_count: int
    price_increase_count: int
    subscriptions: list[SubscriptionItem]
    dismissed: list[SubscriptionItem]
    candidates: list[SubscriptionCandidate]


def _require_merchant_key(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("merchant_key must not be empty")
    return v


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


class ManualSubscriptionCreate(BaseModel):
    """Manually track a subscription: name it and attach merchant keys.

    The first key becomes the canonical merchant (include rule + nickname);
    the rest are linked into it.
    """
    name: str
    merchant_keys: list[str]

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v[:120]  # nickname column width

    @field_validator("merchant_keys")
    @classmethod
    def keys_not_empty(cls, v: list[str]) -> list[str]:
        v = [_require_merchant_key(k) for k in v]
        if not v:
            raise ValueError("merchant_keys must not be empty")
        return v


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

    model_config = {"from_attributes": True}
