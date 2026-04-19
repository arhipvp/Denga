from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Category,
    CategoryType,
    Household,
    Transaction,
    TransactionEditSessionStatus,
    TransactionStatus,
    TransactionType,
    User,
    UserRole,
)
from app.repositories.transaction_edit_session_repository import TransactionEditSessionRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services_core import bootstrap_household_id


def test_list_recent_for_author_returns_latest_non_cancelled_transactions() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(id="user-1", household_id=household_id, email=None, password_hash=None, display_name="User", role=UserRole.MEMBER)
        parent = Category(id="parent-1", household_id=household_id, parent_id=None, name="Еда", type=CategoryType.EXPENSE, is_active=True)
        category = Category(id="cat-1", household_id=household_id, parent_id=parent.id, name="Кафе", type=CategoryType.EXPENSE, is_active=True)
        db.add_all([user, parent, category])
        for index in range(12):
            db.add(
                Transaction(
                    id=f"tx-{index}",
                    household_id=household_id,
                    author_id=user.id,
                    category_id=category.id,
                    source_message_id=None,
                    type=TransactionType.EXPENSE,
                    amount=index + 1,
                    currency="EUR",
                    occurred_at=datetime(2026, 4, min(index + 1, 28)),
                    comment=f"Операция {index}",
                    status=TransactionStatus.CANCELLED if index == 0 else TransactionStatus.CONFIRMED,
                )
            )
        db.commit()

        result = TransactionRepository(db).list_recent_for_author(user.id, limit=10)

    assert len(result) == 10
    assert result[0].id == "tx-11"
    assert all(item.status != TransactionStatus.CANCELLED for item in result)


def test_transaction_edit_session_repository_tracks_active_session() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(id="user-1", household_id=household_id, email=None, password_hash=None, display_name="User", role=UserRole.MEMBER)
        parent = Category(id="parent-1", household_id=household_id, parent_id=None, name="Еда", type=CategoryType.EXPENSE, is_active=True)
        category = Category(id="cat-1", household_id=household_id, parent_id=parent.id, name="Кафе", type=CategoryType.EXPENSE, is_active=True)
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
        db.add_all([user, parent, category, transaction])
        db.commit()

        repo = TransactionEditSessionRepository(db)
        session = repo.create(
            author_id=user.id,
            transaction_id=transaction.id,
            draft={"type": "expense", "amount": 15, "occurredAt": "2026-04-12T00:00:00", "categoryId": category.id},
        )
        active = repo.get_active_for_author(user.id)
        repo.complete(session)
        completed = repo.get_by_id(session.id)

    assert active is not None
    assert active.id == session.id
    assert completed is not None
    assert completed.status == TransactionEditSessionStatus.COMPLETED
