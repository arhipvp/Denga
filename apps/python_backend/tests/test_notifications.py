from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Category, CategoryType, Household, TelegramAccount, Transaction, TransactionStatus, TransactionType, User, UserRole
from app.services_core import bootstrap_household_id
from app.use_cases.notifications import notify_transaction_event


class FakeTelegram:
    def __init__(self) -> None:
        self.sent_messages: list[tuple[str, str, dict | None]] = []

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None = None) -> dict:
        self.sent_messages.append((chat_id, text, reply_markup))
        return {"message_id": 1}


def test_notify_transaction_event_supports_updated_message() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(id="user-1", household_id=household_id, email=None, password_hash=None, display_name="User", role=UserRole.MEMBER)
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(id="parent-1", household_id=household_id, parent_id=None, name="Еда", type=CategoryType.EXPENSE, is_active=True)
        category = Category(id="cat-1", household_id=household_id, parent_id=parent.id, name="Кафе", type=CategoryType.EXPENSE, is_active=True)
        db.add_all([parent, category])
        transaction = Transaction(
            id="tx-1",
            household_id=household_id,
            author_id=user.id,
            category_id=category.id,
            source_message_id=None,
            type=TransactionType.EXPENSE,
            amount=15,
            currency="EUR",
            occurred_at=datetime(2026, 4, 12),
            comment="Обед",
            status=TransactionStatus.CONFIRMED,
        )
        db.add(transaction)
        db.commit()

        telegram = FakeTelegram()
        result = notify_transaction_event(db, {"transactionId": transaction.id, "event": "updated"}, telegram)

    assert result["delivered"] == 1
    assert "Операция обновлена" in telegram.sent_messages[0][1]
