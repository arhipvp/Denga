from __future__ import annotations

import math
from datetime import timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, SourceMessage, SourceMessageStatus, SourceMessageType, Transaction, TransactionStatus, TransactionType, User
from app.repositories.category_repository import CategoryRepository
from app.repositories.settings_repository import SettingsRepository
from app.repositories.transaction_repository import TransactionRepository
from app.schemas import TransactionCreateRequest, TransactionUpdateRequest
from app.services_core import bootstrap_household_id, map_category_type, require_entity
from app.summary import SummaryTransaction, calculate_transaction_summary
from app.use_cases.notifications import enqueue_notification_job


def map_status(value: str | None) -> TransactionStatus | None:
    if value == "confirmed":
        return TransactionStatus.CONFIRMED
    if value == "needs_clarification":
        return TransactionStatus.NEEDS_CLARIFICATION
    if value == "cancelled":
        return TransactionStatus.CANCELLED
    return None


def map_type(value: str | None) -> TransactionType | None:
    if value == "income":
        return TransactionType.INCOME
    if value == "expense":
        return TransactionType.EXPENSE
    return None


def ensure_category_type(db: Session, category_id: str, transaction_type: str) -> Category:
    category = CategoryRepository(db).get_by_id(category_id)
    if not category or category.household_id != bootstrap_household_id():
        raise LookupError("Category not found")
    if category.type != map_category_type(transaction_type):
        raise ValueError("Category type must match transaction type")
    return category


def category_display(category: Category | None) -> dict[str, Any] | None:
    if not category:
        return None
    parent = None
    if category.parent:
        parent = {
            "id": category.parent.id,
            "parentId": category.parent.parent_id,
            "name": category.parent.name,
            "type": category.parent.type.value,
            "isActive": category.parent.is_active,
            "displayPath": category.parent.name,
            "isLeaf": False,
            "children": [],
        }
    return {
        "id": category.id,
        "parentId": category.parent_id,
        "name": category.name,
        "type": category.type.value,
        "isActive": category.is_active,
        "isLeaf": category.parent_id is not None,
        "displayPath": f"{category.parent.name} / {category.name}" if category.parent else category.name,
        "children": [],
        "parent": parent,
        "createdAt": category.created_at.isoformat(),
        "updatedAt": category.updated_at.isoformat(),
    }


def serialize_source_message(message: SourceMessage | None) -> dict[str, Any] | None:
    if not message:
        return None
    attachments = [{"id": item.id, "localPath": item.local_path} for item in getattr(message, "attachments", [])]
    parse_attempts = [
        {
            "id": item.id,
            "attemptType": item.attempt_type.value,
            "model": item.model,
            "responsePayload": item.response_payload,
        }
        for item in getattr(message, "parse_attempts", [])
    ]
    clarification = message.clarification_session
    review_draft = message.review_draft
    return {
        "type": message.type.value,
        "text": message.text,
        "attachments": attachments,
        "parseAttempts": parse_attempts,
        "clarificationSession": (
            {
                "question": clarification.question,
                "status": clarification.status.value,
                "conversation": clarification.conversation,
            }
            if clarification
            else None
        ),
        "reviewDraft": (
            {
                "status": review_draft.status.value,
                "pendingField": review_draft.pending_field,
                "draft": review_draft.draft,
            }
            if review_draft
            else None
        ),
    }


def serialize_transaction(item: Transaction) -> dict[str, Any]:
    return {
        "id": item.id,
        "type": item.type.value,
        "amount": f"{float(item.amount):.2f}",
        "currency": item.currency,
        "occurredAt": item.occurred_at.isoformat(),
        "comment": item.comment,
        "status": item.status.value,
        "category": category_display(item.category),
        "author": {"displayName": item.author.display_name} if item.author else None,
        "sourceMessage": serialize_source_message(item.source_message),
        "createdAt": item.created_at.isoformat(),
        "updatedAt": item.updated_at.isoformat(),
        "categoryId": item.category_id,
    }


def list_transactions(
    db: Session,
    *,
    status: str | None,
    type_: str | None,
    search: str | None,
    sort_by: str | None,
    sort_dir: str | None,
    page: int | None,
    page_size: int | None,
) -> dict[str, Any]:
    page = 1 if not page or page < 1 else math.floor(page)
    page_size = 20 if not page_size or page_size < 1 else min(math.floor(page_size), 100)
    items, total = TransactionRepository(db).list_for_api(
        status=map_status(status),
        type_=map_type(type_),
        search=search,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )
    return {"items": [serialize_transaction(item) for item in items], "total": total, "page": page, "pageSize": page_size}


def transaction_summary(db: Session) -> dict[str, Any]:
    transactions = TransactionRepository(db).list_for_summary()
    recent = sorted(transactions, key=lambda item: item.occurred_at, reverse=True)[:8]
    summary_transactions = [
        SummaryTransaction(
            id=item.id,
            type=item.type.value,
            status=item.status.value,
            amount=float(item.amount),
            occurred_at=item.occurred_at.replace(tzinfo=timezone.utc),
            category_id=item.category_id,
            category_name=item.category.name if item.category else None,
            parent_category_id=item.category.parent.id if item.category and item.category.parent else None,
            parent_category_name=item.category.parent.name if item.category and item.category.parent else None,
        )
        for item in transactions
    ]
    payload = calculate_transaction_summary(summary_transactions)
    payload["recent"] = [serialize_transaction(item) for item in recent]
    return payload


def create_transaction(db: Session, payload: TransactionCreateRequest, author_id: str | None) -> dict[str, Any]:
    ensure_category_type(db, payload.categoryId, payload.type)
    settings_payload = SettingsRepository(db).get_payload()
    source_message = SourceMessage(
        household_id=bootstrap_household_id(),
        author_id=author_id,
        type=SourceMessageType.ADMIN_MANUAL,
        status=SourceMessageStatus.PARSED,
        raw_payload={},
    )
    db.add(source_message)
    db.flush()
    transaction = Transaction(
        household_id=bootstrap_household_id(),
        author_id=author_id,
        source_message_id=source_message.id,
        type=map_type(payload.type) or TransactionType.EXPENSE,
        amount=payload.amount,
        currency=settings_payload["defaultCurrency"],
        occurred_at=payload.occurredAt.replace(tzinfo=None),
        comment=payload.comment,
        category_id=payload.categoryId,
        status=TransactionStatus.CONFIRMED,
    )
    TransactionRepository(db).create(transaction)
    enqueue_notification_job(db, transaction.id, "created")
    return serialize_transaction(require_entity(TransactionRepository(db).get_by_id(transaction.id), "Transaction not found"))


def update_transaction(db: Session, transaction_id: str, payload: TransactionUpdateRequest) -> dict[str, Any]:
    transaction = require_entity(
        db.execute(select(Transaction).where(Transaction.id == transaction_id)).scalar_one_or_none(),
        "Transaction not found",
    )
    final_type = payload.type or ("income" if transaction.type == TransactionType.INCOME else "expense")
    final_category_id = payload.categoryId or transaction.category_id
    if final_category_id:
        ensure_category_type(db, final_category_id, final_type)
    if payload.type is not None:
        transaction.type = map_type(payload.type) or transaction.type
    if payload.amount is not None:
        transaction.amount = payload.amount
    if payload.occurredAt is not None:
        transaction.occurred_at = payload.occurredAt.replace(tzinfo=None)
    if payload.categoryId is not None:
        transaction.category_id = payload.categoryId
    if payload.comment is not None:
        transaction.comment = payload.comment
    if payload.status is not None:
        mapped_status = map_status(payload.status)
        if mapped_status:
            transaction.status = mapped_status
    TransactionRepository(db).commit()
    return serialize_transaction(require_entity(TransactionRepository(db).get_by_id(transaction_id), "Transaction not found"))


def cancel_transaction(db: Session, transaction_id: str) -> dict[str, bool]:
    transaction = require_entity(
        db.execute(select(Transaction).where(Transaction.id == transaction_id)).scalar_one_or_none(),
        "Transaction not found",
    )
    TransactionRepository(db).mark_cancelled(transaction)
    enqueue_notification_job(db, transaction.id, "deleted")
    return {"success": True}
