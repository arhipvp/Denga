from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings, get_settings
from app.logging_utils import logger
from app.models import AppSetting, Category, CategoryType, Household, User
from app.schemas import CategoryUpdateRequest, CategoryWriteRequest, SettingsUpdateRequest, UserRenameRequest
from app.security import create_access_token, hash_password, verify_password


def bootstrap_household_id() -> str:
    return get_settings().bootstrap_household_id


def require_entity(entity: Any, message: str) -> Any:
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
    return entity


def login(db: Session, email: str, password: str) -> dict[str, Any]:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        logger.warn("auth", "login_failed", "Login failed", {"email": email})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    payload = {
        "sub": user.id,
        "email": user.email,
        "role": user.role.value,
    }
    logger.info("auth", "login_succeeded", "Login succeeded", payload)
    return {
        "accessToken": create_access_token(payload),
        "user": payload,
    }


def change_password(db: Session, user_id: str, current_password: str, new_password: str) -> dict[str, bool]:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(current_password, user.password_hash):
        logger.warn("auth", "change_password_failed", "Password change failed", {"userId": user_id})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user.password_hash = hash_password(new_password)
    db.commit()
    logger.info("auth", "change_password_succeeded", "Password changed", {"userId": user.id})
    return {"success": True}


def get_settings_payload(db: Session, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    household = require_entity(
        db.execute(select(Household).where(Household.id == bootstrap_household_id())).scalar_one_or_none(),
        "Household not found",
    )
    entries = db.execute(
        select(AppSetting).where(AppSetting.household_id == bootstrap_household_id())
    ).scalars()
    values = {entry.key: entry.value for entry in entries}
    return {
        "householdName": household.name,
        "defaultCurrency": "EUR",
        "telegramMode": values.get("telegramMode", "polling"),
        "aiModel": values.get("aiModel", settings.polza_model),
        "clarificationTimeoutMinutes": int(values.get("clarificationTimeoutMinutes", "30")),
        "parsingPrompt": values.get(
            "parsingPrompt",
            "Ты разбираешь семейные доходы и расходы из сообщений Telegram. Верни только JSON.",
        ),
        "clarificationPrompt": values.get(
            "clarificationPrompt",
            "Используй историю уточнения и ответ пользователя, чтобы заполнить недостающие поля.",
        ),
    }


def update_settings_payload(db: Session, payload: SettingsUpdateRequest) -> dict[str, Any]:
    household = require_entity(
        db.execute(select(Household).where(Household.id == bootstrap_household_id())).scalar_one_or_none(),
        "Household not found",
    )
    household.name = payload.householdName
    household.default_currency = "EUR"
    entries = {
        "telegramMode": payload.telegramMode,
        "aiModel": payload.aiModel,
        "clarificationTimeoutMinutes": str(payload.clarificationTimeoutMinutes),
        "parsingPrompt": payload.parsingPrompt,
        "clarificationPrompt": payload.clarificationPrompt,
    }
    current = {
        entry.key: entry
        for entry in db.execute(
            select(AppSetting).where(AppSetting.household_id == bootstrap_household_id())
        ).scalars()
    }
    for key, value in entries.items():
        if key in current:
            current[key].value = value
        else:
            db.add(AppSetting(household_id=bootstrap_household_id(), key=key, value=value))
    db.commit()
    return get_settings_payload(db)


def list_users(db: Session) -> list[dict[str, Any]]:
    users = db.execute(
        select(User)
        .where(User.household_id == bootstrap_household_id())
        .options(selectinload(User.telegram_accounts))
        .order_by(User.created_at.asc())
    ).scalars()
    return [
        {
            "id": user.id,
            "displayName": user.display_name,
            "email": user.email,
            "role": user.role.value,
            "createdAt": user.created_at.isoformat(),
            "telegramAccounts": [
                {
                    "telegramId": account.telegram_id,
                    "username": account.username,
                    "isActive": account.is_active,
                }
                for account in sorted(user.telegram_accounts, key=lambda item: item.created_at)
            ],
        }
        for user in users
    ]


def rename_user(db: Session, user_id: str, payload: UserRenameRequest) -> dict[str, Any]:
    user = db.execute(
        select(User).where(User.id == user_id, User.household_id == bootstrap_household_id())
    ).scalar_one_or_none()
    require_entity(user, "Пользователь не найден")
    user.display_name = payload.displayName.strip()
    db.commit()
    users = [item for item in list_users(db) if item["id"] == user_id]
    return require_entity(users[0] if users else None, "Пользователь не найден")


def map_category_type(value: str) -> CategoryType:
    return CategoryType.INCOME if value == "income" else CategoryType.EXPENSE


def _load_household_categories(db: Session) -> list[Category]:
    return list(
        db.execute(
            select(Category)
            .where(Category.household_id == bootstrap_household_id())
            .options(selectinload(Category.children), selectinload(Category.parent))
            .order_by(Category.parent_id.asc(), Category.name.asc())
        ).scalars()
    )


def _category_to_tree_record(category: Category, children: list[dict[str, Any]], parent_name: str | None = None) -> dict[str, Any]:
    display_path = f"{parent_name} / {category.name}" if parent_name else category.name
    return {
        "id": category.id,
        "parentId": category.parent_id,
        "name": category.name,
        "type": category.type.value,
        "isActive": category.is_active,
        "isLeaf": category.parent_id is not None,
        "displayPath": display_path,
        "children": children,
        "createdAt": category.created_at.isoformat(),
        "updatedAt": category.updated_at.isoformat(),
    }


def list_categories(db: Session) -> list[dict[str, Any]]:
    categories = _load_household_categories(db)
    by_parent: dict[str | None, list[Category]] = {}
    for category in categories:
        by_parent.setdefault(category.parent_id, []).append(category)

    def serialize(category: Category, parent_name: str | None = None) -> dict[str, Any]:
        current_path = f"{parent_name} / {category.name}" if parent_name else category.name
        children = [serialize(child, current_path) for child in by_parent.get(category.id, [])]
        return _category_to_tree_record(category, children, parent_name)

    return [serialize(category) for category in by_parent.get(None, [])]


def _validate_parent(db: Session, parent_id: str | None, category_type: CategoryType, current_id: str | None = None) -> Category | None:
    if not parent_id:
        return None
    parent = db.execute(select(Category).where(Category.id == parent_id)).scalar_one_or_none()
    if not parent or parent.household_id != bootstrap_household_id():
        raise HTTPException(status_code=404, detail="Parent category not found")
    if current_id and parent.id == current_id:
        raise HTTPException(status_code=400, detail="Category cannot be its own parent")
    if parent.parent_id:
        raise HTTPException(status_code=400, detail="Only two category levels are supported")
    if parent.type != category_type:
        raise HTTPException(status_code=400, detail="Parent category type must match child category type")
    return parent


def _ensure_sibling_name_available(
    db: Session,
    *,
    parent_id: str | None,
    category_type: CategoryType,
    name: str,
    exclude_id: str | None = None,
) -> None:
    query = select(Category).where(
        Category.household_id == bootstrap_household_id(),
        Category.type == category_type,
        Category.name == name,
    )
    if parent_id is None:
        query = query.where(Category.parent_id.is_(None))
    else:
        query = query.where(Category.parent_id == parent_id)
    if exclude_id:
        query = query.where(Category.id != exclude_id)
    duplicate = db.execute(query).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=400, detail="Category name must be unique within the selected parent")


def create_category(db: Session, payload: CategoryWriteRequest) -> dict[str, Any]:
    category_type = map_category_type(payload.type)
    parent = _validate_parent(db, payload.parentId, category_type)
    _ensure_sibling_name_available(
        db,
        parent_id=payload.parentId,
        category_type=category_type,
        name=payload.name,
    )
    category = Category(
        household_id=bootstrap_household_id(),
        name=payload.name,
        type=category_type,
        is_active=True if payload.isActive is None else payload.isActive,
        parent_id=parent.id if parent else None,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _category_to_tree_record(category, [], parent.name if parent else None)


def update_category(db: Session, category_id: str, payload: CategoryUpdateRequest) -> dict[str, Any]:
    category = db.execute(
        select(Category).options(selectinload(Category.children)).where(Category.id == category_id)
    ).scalar_one_or_none()
    if not category or category.household_id != bootstrap_household_id():
        raise HTTPException(status_code=404, detail="Category not found")

    category_type = map_category_type(payload.type) if payload.type else category.type
    parent_id = category.parent_id
    if "parentId" in payload.model_fields_set:
        parent_id = payload.parentId
    if payload.parentId == category.id:
        raise HTTPException(status_code=400, detail="Category cannot be its own parent")
    if payload.parentId is not None and category.children:
        raise HTTPException(status_code=400, detail="Parent category cannot be moved under another category")

    parent = _validate_parent(db, parent_id, category_type, category.id)
    _ensure_sibling_name_available(
        db,
        parent_id=parent_id,
        category_type=category_type,
        name=payload.name or category.name,
        exclude_id=category.id,
    )
    if payload.name is not None:
        category.name = payload.name
    if payload.type is not None:
        category.type = category_type
    if payload.isActive is not None:
        category.is_active = payload.isActive
    if "parentId" in payload.model_fields_set:
        category.parent_id = parent_id
    db.commit()
    db.refresh(category)
    return _category_to_tree_record(category, [], parent.name if parent else None)


def disable_category(db: Session, category_id: str) -> dict[str, bool]:
    category = db.execute(
        select(Category).options(selectinload(Category.children)).where(Category.id == category_id)
    ).scalar_one_or_none()
    if not category or category.household_id != bootstrap_household_id():
        raise HTTPException(status_code=404, detail="Category not found")
    active_children = [child for child in category.children if child.is_active]
    if active_children:
        raise HTTPException(status_code=400, detail="Cannot disable a parent category with active children")
    category.is_active = False
    db.commit()
    return {"success": True}
