from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.domain.draft_state import DraftLifecycleState
from app.models import (
    ClarificationSession,
    ClarificationStatus,
    Household,
    PendingOperationReview,
    SourceMessage,
    SourceMessageStatus,
    SourceMessageType,
    TelegramAccount,
    User,
    UserRole,
)
from app.repositories.draft_repository import ACTIVE_REVIEW_STATUSES, DraftRepository
from app.services_core import bootstrap_household_id


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_transition_review_syncs_source_and_clarification_statuses() -> None:
    with _make_session() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=None,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.PENDING_REVIEW,
            text="Кофе 5 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=None,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft={},
            pending_field=None,
            last_bot_message_id=None,
            active_picker_message_id=None,
        )
        clarification = ClarificationSession(
            source_message_id=source.id,
            status=ClarificationStatus.OPEN,
            question="Уточните категорию",
            answer=None,
            conversation=[],
            expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=30),
            resolved_at=None,
        )
        db.add_all([source, review, clarification])
        db.commit()

        hydrated_review = DraftRepository(db).get_by_id("draft-1")
        assert hydrated_review is not None

        DraftRepository(db).transition_review(
            hydrated_review,
            current_state=DraftLifecycleState.CLARIFICATION_ENQUEUED,
            next_state=DraftLifecycleState.PENDING_REVIEW,
        )

        refreshed_review = DraftRepository(db).get_by_id("draft-1")
        assert refreshed_review is not None
        assert refreshed_review.status == SourceMessageStatus.PENDING_REVIEW
        assert refreshed_review.source_message.status == SourceMessageStatus.PENDING_REVIEW
        assert refreshed_review.source_message.clarification_session.status == ClarificationStatus.RESOLVED


def test_transition_review_non_strict_mode_keeps_compatibility() -> None:
    with _make_session() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=None,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.PENDING_REVIEW,
            text="Кофе 5 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=None,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft={},
            pending_field=None,
            last_bot_message_id=None,
            active_picker_message_id=None,
        )
        db.add_all([source, review])
        db.commit()

        hydrated_review = DraftRepository(db).get_by_id("draft-1")
        assert hydrated_review is not None

        DraftRepository(db).transition_review(
            hydrated_review,
            current_state=DraftLifecycleState.CONFIRMED,
            next_state=DraftLifecycleState.PENDING_REVIEW,
            strict=False,
        )

        refreshed_review = DraftRepository(db).get_by_id("draft-1")
        assert refreshed_review is not None
        assert refreshed_review.status == SourceMessageStatus.PENDING_REVIEW


def test_active_draft_lookup_includes_needs_clarification() -> None:
    with _make_session() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            text="Кофе 5 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            draft={},
            pending_field=None,
            last_bot_message_id=None,
            active_picker_message_id=None,
        )
        db.add_all([source, review])
        db.commit()

        fetched = DraftRepository(db).get_latest_for_telegram_account("42")

        assert ACTIVE_REVIEW_STATUSES == (
            SourceMessageStatus.PENDING_REVIEW,
            SourceMessageStatus.NEEDS_CLARIFICATION,
        )
        assert fetched is not None
        assert fetched.id == review.id
        assert DraftRepository(db).get_active_for_author(user.id).id == review.id
        assert DraftRepository(db).has_telegram_account("42") is True
        assert DraftRepository(db).has_telegram_account("404") is False
