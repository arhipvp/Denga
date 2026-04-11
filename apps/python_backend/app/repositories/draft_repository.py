from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import PendingOperationReview, SourceMessage, SourceMessageStatus, TelegramAccount, User


class DraftRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

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
