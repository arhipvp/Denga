from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.models import Category, SourceMessage, TelegramAccount, Transaction, TransactionStatus, TransactionType, User
from app.services_core import bootstrap_household_id


class TransactionRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def query(self) -> Any:
        return (
            select(Transaction)
            .options(
                joinedload(Transaction.category).joinedload(Category.parent),
                joinedload(Transaction.author),
                joinedload(Transaction.source_message).joinedload(SourceMessage.clarification_session),
                joinedload(Transaction.source_message).joinedload(SourceMessage.review_draft),
            )
        )

    def get_by_id(self, transaction_id: str) -> Transaction | None:
        return (
            self._db.execute(self.query().where(Transaction.id == transaction_id))
            .unique()
            .scalars()
            .first()
        )

    def get_by_id_for_author(self, transaction_id: str, author_id: str) -> Transaction | None:
        return (
            self._db.execute(
                self.query().where(
                    Transaction.id == transaction_id,
                    Transaction.author_id == author_id,
                    Transaction.household_id == bootstrap_household_id(),
                    Transaction.status != TransactionStatus.CANCELLED,
                )
            )
            .unique()
            .scalars()
            .first()
        )

    def get_for_notification(self, transaction_id: str) -> Transaction | None:
        return (
            self._db.execute(
                select(Transaction)
                .where(Transaction.id == transaction_id, Transaction.household_id == bootstrap_household_id())
                .options(joinedload(Transaction.author), joinedload(Transaction.category).joinedload(Category.parent))
            )
            .scalars()
            .first()
        )

    def list_for_api(
        self,
        *,
        status: TransactionStatus | None,
        type_: TransactionType | None,
        search: str | None,
        sort_by: str | None,
        sort_dir: str | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Transaction], int]:
        query = self.query().where(Transaction.household_id == bootstrap_household_id())
        count_query = select(func.count()).select_from(Transaction).where(Transaction.household_id == bootstrap_household_id())
        if status:
            query = query.where(Transaction.status == status)
            count_query = count_query.where(Transaction.status == status)
        if type_:
            query = query.where(Transaction.type == type_)
            count_query = count_query.where(Transaction.type == type_)
        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            search_clause = or_(
                func.lower(func.coalesce(Transaction.comment, "")).like(term),
                Transaction.category.has(func.lower(Category.name).like(term)),
                Transaction.author.has(func.lower(User.display_name).like(term)),
                Transaction.source_message.has(func.lower(func.coalesce(SourceMessage.text, "")).like(term)),
            )
            query = query.where(search_clause)
            count_query = count_query.where(search_clause)

        direction = "asc" if sort_dir == "asc" else "desc"
        if sort_by == "amount":
            query = query.order_by(text(f'"amount" {direction}'), Transaction.occurred_at.desc())
        elif sort_by == "type":
            query = query.order_by(text(f'"type" {direction}'), Transaction.occurred_at.desc())
        elif sort_by == "status":
            query = query.order_by(text(f'"status" {direction}'), Transaction.occurred_at.desc())
        elif sort_by == "createdAt":
            query = query.order_by(text(f'"createdAt" {direction}'), Transaction.occurred_at.desc())
        else:
            query = query.order_by(Transaction.occurred_at.desc())

        total = self._db.execute(count_query).scalar_one()
        items = list(self._db.execute(query.offset((page - 1) * page_size).limit(page_size)).unique().scalars())
        return items, total

    def list_for_summary(self) -> list[Transaction]:
        return list(
            self._db.execute(
                self.query().where(Transaction.household_id == bootstrap_household_id()).order_by(Transaction.occurred_at.asc())
            )
            .unique()
            .scalars()
        )

    def create(self, transaction: Transaction) -> Transaction:
        self._db.add(transaction)
        self._db.commit()
        self._db.refresh(transaction)
        return transaction

    def list_recent_for_author(self, author_id: str, *, limit: int = 10) -> list[Transaction]:
        return list(
            self._db.execute(
                self.query()
                .where(
                    Transaction.author_id == author_id,
                    Transaction.household_id == bootstrap_household_id(),
                    Transaction.status != TransactionStatus.CANCELLED,
                )
                .order_by(Transaction.occurred_at.desc(), Transaction.created_at.desc())
                .limit(limit)
            )
            .unique()
            .scalars()
        )

    def commit(self) -> None:
        self._db.commit()

    def list_notification_recipient_ids(self, *, excluded: list[str] | None = None) -> list[str]:
        excluded_set = {item.strip() for item in excluded or [] if str(item).strip()}
        recipients = list(
            self._db.execute(
                select(TelegramAccount)
                .join(User, TelegramAccount.user_id == User.id)
                .where(TelegramAccount.is_active.is_(True), User.household_id == bootstrap_household_id())
                .order_by(TelegramAccount.created_at.asc())
            ).scalars()
        )
        recipient_ids: list[str] = []
        for item in recipients:
            telegram_id = (item.telegram_id or "").strip()
            if telegram_id and telegram_id not in excluded_set and telegram_id not in recipient_ids:
                recipient_ids.append(telegram_id)
        return recipient_ids

    def mark_cancelled(self, transaction: Transaction) -> None:
        transaction.status = TransactionStatus.CANCELLED
        self._db.commit()

    def touch_updated_at(self) -> datetime:
        return datetime.now(timezone.utc)
