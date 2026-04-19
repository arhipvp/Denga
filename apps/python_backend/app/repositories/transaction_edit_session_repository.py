from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Category, TelegramAccount, Transaction, TransactionEditSession, TransactionEditSessionStatus


class TransactionEditSessionRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, session_id: str) -> TransactionEditSession | None:
        return (
            self._db.execute(
                select(TransactionEditSession)
                .where(TransactionEditSession.id == session_id)
                .options(joinedload(TransactionEditSession.transaction).joinedload(Transaction.category).joinedload(Category.parent))
            )
            .scalars()
            .first()
        )

    def get_active_for_author(self, author_id: str) -> TransactionEditSession | None:
        return (
            self._db.execute(
                select(TransactionEditSession)
                .where(
                    TransactionEditSession.author_id == author_id,
                    TransactionEditSession.status == TransactionEditSessionStatus.ACTIVE,
                )
                .options(joinedload(TransactionEditSession.transaction).joinedload(Transaction.category).joinedload(Category.parent))
                .order_by(TransactionEditSession.updated_at.desc())
            )
            .scalars()
            .first()
        )

    def get_active_for_telegram_account(self, telegram_id: str) -> TransactionEditSession | None:
        author_id = self._db.execute(
            select(TelegramAccount.user_id).where(TelegramAccount.telegram_id == telegram_id)
        ).scalar_one_or_none()
        if not author_id:
            return None
        return self.get_active_for_author(author_id)

    def create(self, *, author_id: str, transaction_id: str, draft: dict) -> TransactionEditSession:
        session = TransactionEditSession(
            author_id=author_id,
            transaction_id=transaction_id,
            draft=draft,
            status=TransactionEditSessionStatus.ACTIVE,
        )
        self._db.add(session)
        self._db.commit()
        self._db.refresh(session)
        return session

    def save(self, session: TransactionEditSession) -> TransactionEditSession:
        self._db.add(session)
        self._db.commit()
        self._db.refresh(session)
        return session

    def cancel(self, session: TransactionEditSession) -> TransactionEditSession:
        session.status = TransactionEditSessionStatus.CANCELLED
        session.pending_field = None
        session.active_picker_message_id = None
        self._db.commit()
        self._db.refresh(session)
        return session

    def complete(self, session: TransactionEditSession) -> TransactionEditSession:
        session.status = TransactionEditSessionStatus.COMPLETED
        session.pending_field = None
        session.active_picker_message_id = None
        self._db.commit()
        self._db.refresh(session)
        return session
