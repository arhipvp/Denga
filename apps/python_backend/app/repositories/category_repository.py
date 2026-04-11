from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import Category, CategoryType
from app.services_core import bootstrap_household_id
from app.telegram_types import ActiveCategory


class CategoryRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, category_id: str) -> Category | None:
        return (
            self._db.execute(
                select(Category)
                .where(Category.id == category_id)
                .options(joinedload(Category.parent))
            )
            .scalars()
            .first()
        )

    def list_active(self, type_: str | None = None) -> list[ActiveCategory]:
        query = (
            select(Category)
            .where(
                Category.household_id == bootstrap_household_id(),
                Category.is_active.is_(True),
                Category.parent_id.is_not(None),
            )
            .options(selectinload(Category.parent))
            .order_by(Category.name.asc())
        )
        if type_:
            query = query.where(Category.type == (CategoryType.INCOME if type_ == "income" else CategoryType.EXPENSE))
        rows = list(self._db.execute(query).scalars())
        result: list[ActiveCategory] = []
        for item in rows:
            if not item.parent or not item.parent.is_active:
                continue
            result.append(
                ActiveCategory(
                    id=item.id,
                    name=item.name,
                    type=item.type,
                    parent_id=item.parent_id or "",
                    parent_name=item.parent.name,
                    display_path=f"{item.parent.name} / {item.name}",
                )
            )
        result.sort(key=lambda item: item.display_path.lower())
        return result
