from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.domain.draft_state import (
    CLARIFICATION_STATUS_BY_LIFECYCLE,
    REVIEW_STATUS_BY_LIFECYCLE,
    SOURCE_STATUS_BY_LIFECYCLE,
    DraftLifecycleState,
    transition_draft_state,
)
from app.models import ClarificationSession, ClarificationStatus, PendingOperationReview, SourceMessage, SourceMessageStatus, TelegramAccount, User


class DraftRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, draft_id: str) -> PendingOperationReview | None:
        return (
            self._db.execute(
                select(PendingOperationReview)
                .where(PendingOperationReview.id == draft_id)
                .options(
                    joinedload(PendingOperationReview.source_message).selectinload(SourceMessage.attachments),
                    joinedload(PendingOperationReview.author).selectinload(User.telegram_accounts),
                )
            )
            .scalars()
            .first()
        )

    def get_active_for_author(self, author_id: str) -> PendingOperationReview | None:
        return (
            self._db.execute(
                select(PendingOperationReview)
                .where(
                    PendingOperationReview.author_id == author_id,
                    PendingOperationReview.status == SourceMessageStatus.PENDING_REVIEW,
                )
                .options(joinedload(PendingOperationReview.source_message).selectinload(SourceMessage.attachments))
                .order_by(PendingOperationReview.updated_at.desc())
            )
            .scalars()
            .first()
        )

    def get_latest_for_telegram_account(self, telegram_id: str) -> PendingOperationReview | None:
        account = (
            self._db.execute(select(TelegramAccount).where(TelegramAccount.telegram_id == telegram_id).options(joinedload(TelegramAccount.user)))
            .scalar_one_or_none()
        )
        if not account or not account.user:
            return None
        return (
            self._db.execute(
                select(PendingOperationReview)
                .where(
                    PendingOperationReview.author_id == account.user.id,
                    PendingOperationReview.status == SourceMessageStatus.PENDING_REVIEW,
                )
                .order_by(PendingOperationReview.updated_at.desc())
            )
            .scalars()
            .first()
        )

    def create_review(self, *, source_message_id: str, author_id: str | None, draft_payload: dict) -> PendingOperationReview:
        review = PendingOperationReview(
            source_message_id=source_message_id,
            author_id=author_id,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft=draft_payload,
        )
        self._db.add(review)
        self._db.commit()
        self._db.refresh(review)
        return review

    def save_draft(
        self,
        review: PendingOperationReview,
        *,
        draft_payload: dict,
        pending_field: str | None = None,
        active_picker_message_id: str | None = None,
        last_bot_message_id: str | None = None,
    ) -> PendingOperationReview:
        review.draft = draft_payload
        review.pending_field = pending_field
        review.active_picker_message_id = active_picker_message_id
        if last_bot_message_id is not None:
            review.last_bot_message_id = last_bot_message_id
        self._db.commit()
        self._db.refresh(review)
        return review

    def transition_review(
        self,
        review: PendingOperationReview,
        *,
        current_state: DraftLifecycleState,
        next_state: DraftLifecycleState,
        strict: bool | None = None,
    ) -> DraftLifecycleState:
        strict = get_settings().feature_strict_draft_state_enabled if strict is None else strict
        resolved_state = transition_draft_state(current_state, next_state, strict=strict)

        review.status = SourceMessageStatus(REVIEW_STATUS_BY_LIFECYCLE[resolved_state])
        if review.source_message:
            review.source_message.status = SourceMessageStatus(SOURCE_STATUS_BY_LIFECYCLE[resolved_state])

        clarification_status = CLARIFICATION_STATUS_BY_LIFECYCLE[resolved_state]
        clarification = review.source_message.clarification_session if review.source_message else None
        if clarification and clarification_status is not None:
            clarification.status = ClarificationStatus(clarification_status)
            if clarification_status == ClarificationStatus.RESOLVED.value and clarification.resolved_at is None:
                clarification.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        elif clarification and clarification_status is None and clarification.status == ClarificationStatus.OPEN:
            clarification.status = ClarificationStatus.RESOLVED
            if clarification.resolved_at is None:
                clarification.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)

        self._db.commit()
        self._db.refresh(review)
        return resolved_state

    def upsert_clarification_session(
        self,
        *,
        source_message_id: str,
        question: str,
        timeout_minutes: int,
    ) -> ClarificationSession:
        session = (
            self._db.execute(
                select(ClarificationSession).where(ClarificationSession.source_message_id == source_message_id)
            )
            .scalars()
            .first()
        )
        expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=timeout_minutes)
        if session:
            session.status = ClarificationStatus.OPEN
            session.question = question
            session.expires_at = expires_at
            session.resolved_at = None
            session.answer = None
        else:
            session = ClarificationSession(
                source_message_id=source_message_id,
                status=ClarificationStatus.OPEN,
                question=question,
                answer=None,
                conversation=[],
                expires_at=expires_at,
                resolved_at=None,
            )
            self._db.add(session)
        self._db.commit()
        self._db.refresh(session)
        return session

    def resolve_clarification_session(self, *, source_message_id: str, answer: str) -> ClarificationSession | None:
        session = (
            self._db.execute(
                select(ClarificationSession).where(ClarificationSession.source_message_id == source_message_id)
            )
            .scalars()
            .first()
        )
        if not session:
            return None
        conversation = list(session.conversation or [])
        conversation.append({"role": "user", "text": answer, "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")})
        session.status = ClarificationStatus.RESOLVED
        session.answer = answer
        session.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        session.conversation = conversation
        self._db.commit()
        self._db.refresh(session)
        return session
