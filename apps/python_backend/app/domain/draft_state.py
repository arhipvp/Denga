from __future__ import annotations

from enum import StrEnum


class DraftLifecycleState(StrEnum):
    RECEIVED = "received"
    PARSED = "parsed"
    PENDING_REVIEW = "pending_review"
    NEEDS_CLARIFICATION = "needs_clarification"
    CLARIFICATION_ENQUEUED = "clarification_enqueued"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


_ALLOWED_TRANSITIONS: dict[DraftLifecycleState, set[DraftLifecycleState]] = {
    DraftLifecycleState.RECEIVED: {DraftLifecycleState.PARSED, DraftLifecycleState.CANCELLED},
    DraftLifecycleState.PARSED: {DraftLifecycleState.PENDING_REVIEW, DraftLifecycleState.CANCELLED},
    DraftLifecycleState.PENDING_REVIEW: {
        DraftLifecycleState.NEEDS_CLARIFICATION,
        DraftLifecycleState.CLARIFICATION_ENQUEUED,
        DraftLifecycleState.CONFIRMED,
        DraftLifecycleState.CANCELLED,
        DraftLifecycleState.EXPIRED,
    },
    DraftLifecycleState.NEEDS_CLARIFICATION: {
        DraftLifecycleState.CLARIFICATION_ENQUEUED,
        DraftLifecycleState.PENDING_REVIEW,
        DraftLifecycleState.CANCELLED,
        DraftLifecycleState.EXPIRED,
    },
    DraftLifecycleState.CLARIFICATION_ENQUEUED: {
        DraftLifecycleState.PENDING_REVIEW,
        DraftLifecycleState.NEEDS_CLARIFICATION,
        DraftLifecycleState.CANCELLED,
        DraftLifecycleState.EXPIRED,
    },
    DraftLifecycleState.CONFIRMED: set(),
    DraftLifecycleState.CANCELLED: set(),
    DraftLifecycleState.EXPIRED: set(),
}

REVIEW_STATUS_BY_LIFECYCLE: dict[DraftLifecycleState, str] = {
    DraftLifecycleState.RECEIVED: "RECEIVED",
    DraftLifecycleState.PARSED: "PARSED",
    DraftLifecycleState.PENDING_REVIEW: "PENDING_REVIEW",
    DraftLifecycleState.NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION",
    DraftLifecycleState.CLARIFICATION_ENQUEUED: "NEEDS_CLARIFICATION",
    DraftLifecycleState.CONFIRMED: "PARSED",
    DraftLifecycleState.CANCELLED: "CANCELLED",
    DraftLifecycleState.EXPIRED: "CANCELLED",
}

SOURCE_STATUS_BY_LIFECYCLE: dict[DraftLifecycleState, str] = REVIEW_STATUS_BY_LIFECYCLE.copy()

CLARIFICATION_STATUS_BY_LIFECYCLE: dict[DraftLifecycleState, str | None] = {
    DraftLifecycleState.RECEIVED: None,
    DraftLifecycleState.PARSED: None,
    DraftLifecycleState.PENDING_REVIEW: None,
    DraftLifecycleState.NEEDS_CLARIFICATION: "OPEN",
    DraftLifecycleState.CLARIFICATION_ENQUEUED: "OPEN",
    DraftLifecycleState.CONFIRMED: "RESOLVED",
    DraftLifecycleState.CANCELLED: "CANCELLED",
    DraftLifecycleState.EXPIRED: "EXPIRED",
}


def transition_draft_state(
    current: DraftLifecycleState,
    next_state: DraftLifecycleState,
    *,
    strict: bool = True,
) -> DraftLifecycleState:
    if next_state == current:
        return current
    if next_state not in _ALLOWED_TRANSITIONS[current]:
        if not strict:
            return next_state
        raise ValueError(f"Invalid draft transition: {current} -> {next_state}")
    return next_state
