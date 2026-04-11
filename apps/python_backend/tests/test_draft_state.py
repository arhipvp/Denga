import pytest

from app.domain.draft_state import DraftLifecycleState, transition_draft_state


def test_allows_known_transition() -> None:
    assert (
        transition_draft_state(DraftLifecycleState.PENDING_REVIEW, DraftLifecycleState.CLARIFICATION_ENQUEUED)
        == DraftLifecycleState.CLARIFICATION_ENQUEUED
    )


def test_rejects_invalid_transition() -> None:
    with pytest.raises(ValueError):
        transition_draft_state(DraftLifecycleState.CONFIRMED, DraftLifecycleState.PENDING_REVIEW)
