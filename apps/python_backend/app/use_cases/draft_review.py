from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.domain.draft_state import DraftLifecycleState
from app.models import Category, CategoryType, PendingOperationReview, Transaction, TransactionStatus, TransactionType, User
from app.repositories.category_repository import CategoryRepository
from app.repositories.draft_repository import DraftRepository
from app.repositories.settings_repository import SettingsRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services_core import bootstrap_household_id
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import (
    CATEGORY_LEAF_PAGE_CALLBACK_PREFIX,
    CATEGORY_PARENT_CALLBACK_PREFIX,
    CATEGORY_PARENT_PAGE_CALLBACK_PREFIX,
    TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK,
    TELEGRAM_INCOME_CURRENT_MONTH_CALLBACK,
    build_category_picker_page,
    create_draft_keyboard,
    get_missing_draft_fields,
    normalize_date,
    render_draft_text,
)
from app.telegram_stats import send_current_month_report
from app.telegram_types import ReviewDraft
from app.use_cases.notifications import enqueue_notification_job


def clear_active_picker_message(chat_id: str | None, message_id: str | None, telegram: TelegramAdapter) -> None:
    if not chat_id or not message_id:
        return
    try:
        numeric_message_id = int(message_id)
    except (TypeError, ValueError):
        return
    if not telegram.delete_message(chat_id, numeric_message_id):
        telegram.clear_inline_keyboard(chat_id, numeric_message_id)


def render_or_send_draft_card(db: Session, draft_id: str, chat_id: str, telegram: TelegramAdapter) -> None:
    review = DraftRepository(db).get_by_id(draft_id)
    if review is None:
        raise RuntimeError("Draft not found")
    draft = ReviewDraft.from_dict(review.draft)
    text_value = render_draft_text(draft, confirmed=False)
    active_picker_id = review.active_picker_message_id
    if active_picker_id:
        review.active_picker_message_id = None
        db.commit()
        clear_active_picker_message(chat_id, active_picker_id, telegram)
    keyboard = create_draft_keyboard()
    if review.last_bot_message_id and telegram.edit_message(chat_id, int(review.last_bot_message_id), text_value, keyboard):
        return
    sent = telegram.send_message(chat_id, text_value, keyboard)
    review.last_bot_message_id = str(sent.get("message_id") or 0)
    db.commit()


def upsert_clarification_session(db: Session, source_message_id: str, draft: ReviewDraft) -> None:
    question = draft.follow_up_question or "Пожалуйста, уточните недостающие поля операции."
    DraftRepository(db).upsert_clarification_session(
        source_message_id=source_message_id,
        question=question,
        timeout_minutes=int(SettingsRepository(db).get_payload()["clarificationTimeoutMinutes"]),
    )


def resolve_clarification_session(db: Session, source_message_id: str, answer: str) -> None:
    DraftRepository(db).resolve_clarification_session(source_message_id=source_message_id, answer=answer)


def create_transaction_from_draft(db: Session, review: PendingOperationReview, draft: ReviewDraft) -> Transaction:
    category = CategoryRepository(db).get_by_id(draft.category_id or "")
    if not category or category.household_id != bootstrap_household_id():
        raise RuntimeError("Category not found")
    if category.parent_id is None:
        raise RuntimeError("Transactions can only use subcategories")
    expected = CategoryType.INCOME if draft.type == "income" else CategoryType.EXPENSE
    if category.type != expected:
        raise RuntimeError("Category type does not match transaction type")
    settings = SettingsRepository(db).get_payload()
    transaction = Transaction(
        household_id=bootstrap_household_id(),
        author_id=review.author_id,
        category_id=draft.category_id,
        source_message_id=review.source_message_id,
        type=TransactionType.INCOME if draft.type == "income" else TransactionType.EXPENSE,
        amount=draft.amount,
        currency=draft.currency or settings["defaultCurrency"],
        occurred_at=datetime.fromisoformat((draft.occurred_at or datetime.now(timezone.utc).isoformat()).replace("Z", "+00:00")).replace(tzinfo=None),
        comment=draft.comment,
        status=TransactionStatus.CONFIRMED,
    )
    TransactionRepository(db).create(transaction)
    review = DraftRepository(db).get_by_id(review.id) or review
    DraftRepository(db).transition_review(
        review,
        current_state=DraftLifecycleState.PENDING_REVIEW,
        next_state=DraftLifecycleState.CONFIRMED,
    )
    review.pending_field = None
    review.active_picker_message_id = None
    db.commit()
    db.refresh(transaction)
    return transaction


def cancel_draft(db: Session, review: PendingOperationReview, chat_id: str | None, telegram: TelegramAdapter) -> dict[str, Any]:
    active_picker_id = review.active_picker_message_id
    DraftRepository(db).transition_review(
        review,
        current_state=DraftLifecycleState.PENDING_REVIEW,
        next_state=DraftLifecycleState.CANCELLED,
    )
    review.active_picker_message_id = None
    review.pending_field = None
    db.commit()
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    return {"accepted": True, "status": "cancelled"}


def apply_manual_edit(
    db: Session,
    draft_id: str,
    field: str,
    value: str,
    chat_id: str,
    telegram: TelegramAdapter,
    user_message_id: str | None = None,
) -> dict[str, Any]:
    review = DraftRepository(db).get_by_id(draft_id)
    if review is None:
        raise RuntimeError("Draft not found")
    draft = ReviewDraft.from_dict(review.draft)
    active_picker_id = review.active_picker_message_id
    last_bot_message_id = review.last_bot_message_id
    if field == "amount":
        import re

        match = re.search(r"\d+(?:\.\d+)?", value.replace(",", "."))
        draft.amount = float(match.group(0)) if match else None
    elif field == "date":
        draft.occurred_at = normalize_date(value)
    elif field == "comment":
        draft.comment = value
    review.draft = draft.to_dict()
    review.pending_field = None
    review.active_picker_message_id = None
    db.commit()
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    if user_message_id:
        try:
            telegram.delete_message(chat_id, int(user_message_id))
        except (TypeError, ValueError):
            pass
    if last_bot_message_id:
        clear_active_picker_message(chat_id, last_bot_message_id, telegram)
    text_value = render_draft_text(draft, confirmed=False)
    sent = telegram.send_message(chat_id, text_value, create_draft_keyboard())
    review.last_bot_message_id = str(sent.get("message_id") or 0)
    db.commit()
    return {"accepted": True, "status": "pending_review"}


def show_category_page(
    db: Session,
    draft_id: str,
    chat_id: str,
    message_id: int | None,
    requested_page: int,
    telegram: TelegramAdapter,
    *,
    parent_id: str | None,
    parent_page: int,
) -> dict[str, Any]:
    draft_record = DraftRepository(db).get_by_id(draft_id)
    if draft_record is None:
        raise RuntimeError("Draft not found")
    review_draft = ReviewDraft.from_dict(draft_record.draft)
    categories = CategoryRepository(db).list_active(review_draft.type)
    page_payload = build_category_picker_page(categories, requested_page, parent_id=parent_id, parent_page=parent_page)
    if not page_payload:
        text_value = "Нет активных категорий для выбранного типа операции."
        if message_id is None:
            telegram.send_message(chat_id, text_value)
        else:
            telegram.edit_message(chat_id, message_id, text_value)
        return {"accepted": True, "status": "editing_category_empty"}
    if message_id is None:
        result = telegram.send_message(chat_id, page_payload["text"], page_payload["replyMarkup"])
        draft_record.active_picker_message_id = str(result.get("message_id") or 0)
    else:
        draft_record.active_picker_message_id = str(message_id)
        telegram.edit_message(chat_id, message_id, page_payload["text"], page_payload["replyMarkup"])
    db.commit()
    return {"accepted": True, "status": "editing_category"}


def begin_field_edit(db: Session, draft_id: str, field: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    draft = DraftRepository(db).get_by_id(draft_id)
    if draft is None:
        raise RuntimeError("Draft not found")
    active_picker_id = draft.active_picker_message_id
    if field == "type":
        draft.pending_field = None
        draft.active_picker_message_id = None
        db.commit()
        clear_active_picker_message(chat_id, active_picker_id, telegram)
        result = telegram.send_message(
            chat_id,
            "Выберите тип операции:",
            {"inline_keyboard": [[{"text": "Доход", "callback_data": "draft:set-type:income"}, {"text": "Расход", "callback_data": "draft:set-type:expense"}]]},
        )
        draft.active_picker_message_id = str(result.get("message_id") or 0)
        db.commit()
        return {"accepted": True, "status": "editing_type"}
    if field == "category":
        draft.pending_field = None
        draft.active_picker_message_id = None
        db.commit()
        clear_active_picker_message(chat_id, active_picker_id, telegram)
        return show_category_page(db, draft_id, chat_id, None, 0, telegram, parent_id=None, parent_page=0)
    prompts = {"amount": "Введите новую сумму.", "date": 'Введите новую дату. Можно написать "сегодня" или "2026-03-31".', "comment": "Введите новый комментарий."}
    draft.pending_field = field
    draft.active_picker_message_id = None
    db.commit()
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    result = telegram.send_message(chat_id, prompts.get(field, "Введите новое значение."))
    draft.active_picker_message_id = str(result.get("message_id") or 0)
    db.commit()
    return {"accepted": True, "status": "awaiting_edit"}


def confirm_draft(db: Session, draft_id: str, chat_id: str, message_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    review = (
        db.execute(
            select(PendingOperationReview)
            .where(PendingOperationReview.id == draft_id)
            .options(joinedload(PendingOperationReview.author).selectinload(User.telegram_accounts))
        )
        .scalars()
        .first()
    )
    if review is None:
        raise RuntimeError("Draft not found")
    draft = ReviewDraft.from_dict(review.draft)
    missing = get_missing_draft_fields(draft)
    if missing:
        telegram.send_message(chat_id, f"Перед подтверждением нужно заполнить: {', '.join(missing)}.")
        render_or_send_draft_card(db, draft_id, chat_id, telegram)
        return {"accepted": True, "status": "missing_fields"}
    try:
        transaction = create_transaction_from_draft(db, review, draft)
    except RuntimeError as exc:
        telegram.send_message(
            chat_id,
            "Категория не соответствует типу операции." if str(exc) == "Category type does not match transaction type" else "Категория не найдена. Выберите заново.",
        )
        return {"accepted": True, "status": "invalid_category"}
    clear_active_picker_message(chat_id, review.active_picker_message_id, telegram)
    review.last_bot_message_id = message_id
    review.active_picker_message_id = None
    review.pending_field = None
    db.commit()
    text_value = render_draft_text(draft, confirmed=True)
    if not telegram.edit_message(chat_id, int(message_id), text_value):
        telegram.clear_inline_keyboard(chat_id, int(message_id))
        telegram.send_message(chat_id, text_value)
    exclude = [item.telegram_id for item in (review.author.telegram_accounts if review.author else []) if item.is_active]
    enqueue_notification_job(db, transaction.id, "created", exclude)
    resolve_clarification_session(db, review.source_message_id, draft.source_text or "")
    return {"accepted": True, "status": "confirmed", "transactionId": transaction.id}


def handle_callback_query(db: Session, callback: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    data = callback.get("data") or ""
    chat_id = str(((callback.get("message") or {}).get("chat") or {}).get("id") or callback.get("from", {}).get("id"))
    message_id = str((callback.get("message") or {}).get("message_id") or "")
    author_telegram_id = str((callback.get("from") or {}).get("id"))
    if data in {TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK, TELEGRAM_INCOME_CURRENT_MONTH_CALLBACK}:
        telegram.answer_callback_query(callback["id"])
        return send_current_month_report(
            db,
            telegram,
            chat_id,
            type_=TransactionType.EXPENSE if data == TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK else TransactionType.INCOME,
        )
    draft = DraftRepository(db).get_latest_for_telegram_account(author_telegram_id)
    if not draft:
        telegram.answer_callback_query(callback["id"], "Пользователь не найден")
        return {"accepted": True, "ignored": True}
    if data == "draft:confirm":
        telegram.answer_callback_query(callback["id"])
        return confirm_draft(db, draft.id, chat_id, message_id, telegram)
    if data == "draft:cancel":
        telegram.answer_callback_query(callback["id"])
        cancel_draft(db, draft, chat_id, telegram)
        telegram.edit_message(chat_id, int(message_id), "Операция отменена.")
        return {"accepted": True, "status": "cancelled"}
    if data.startswith("draft:edit:"):
        telegram.answer_callback_query(callback["id"])
        return begin_field_edit(db, draft.id, data.replace("draft:edit:", ""), chat_id, telegram)
    if data.startswith("draft:set-type:"):
        telegram.answer_callback_query(callback["id"])
        review_draft = ReviewDraft.from_dict(draft.draft)
        review_draft.type = data.replace("draft:set-type:", "")
        review_draft.category_id = None
        review_draft.category_name = None
        clear_active_picker_message(chat_id, draft.active_picker_message_id, telegram)
        draft.draft = review_draft.to_dict()
        draft.active_picker_message_id = None
        draft.pending_field = None
        db.commit()
        render_or_send_draft_card(db, draft.id, chat_id, telegram)
        return {"accepted": True, "status": "pending_review"}
    if data.startswith("draft:set-category:"):
        category_id = data.replace("draft:set-category:", "")
        category = (
            db.execute(select(Category).where(Category.id == category_id).options(joinedload(Category.parent)))
            .scalars()
            .first()
        )
        if not category:
            telegram.answer_callback_query(callback["id"], "Категория не найдена")
            return {"accepted": True, "ignored": True}
        if not category.parent_id:
            telegram.answer_callback_query(callback["id"], "Нужно выбрать подкатегорию")
            return {"accepted": True, "ignored": True}
        telegram.answer_callback_query(callback["id"])
        review_draft = ReviewDraft.from_dict(draft.draft)
        review_draft.category_id = category.id
        review_draft.category_name = f"{category.parent.name if category.parent else 'Без родителя'} / {category.name}"
        clear_active_picker_message(chat_id, draft.active_picker_message_id, telegram)
        draft.draft = review_draft.to_dict()
        draft.active_picker_message_id = None
        draft.pending_field = None
        db.commit()
        render_or_send_draft_card(db, draft.id, chat_id, telegram)
        return {"accepted": True, "status": "pending_review"}
    if data.startswith(CATEGORY_PARENT_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        parent_payload = data.replace(CATEGORY_PARENT_CALLBACK_PREFIX, "")
        parent_id, _, parent_page_value = parent_payload.partition(":")
        return show_category_page(db, draft.id, chat_id, int(message_id), 0, telegram, parent_id=parent_id, parent_page=int(parent_page_value or "0"))
    if data.startswith(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        page = int(data.replace(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX, "") or "0")
        return show_category_page(db, draft.id, chat_id, int(message_id), page, telegram, parent_id=None, parent_page=page)
    if data.startswith(CATEGORY_LEAF_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        payload = data.replace(CATEGORY_LEAF_PAGE_CALLBACK_PREFIX, "")
        parent_id, parent_page_value, page_value = (payload.split(":", 2) + ["0", "0"])[:3]
        return show_category_page(
            db,
            draft.id,
            chat_id,
            int(message_id),
            int(page_value or "0"),
            telegram,
            parent_id=parent_id,
            parent_page=int(parent_page_value or "0"),
        )
    telegram.answer_callback_query(callback["id"], "Неизвестное действие")
    return {"accepted": True, "ignored": True}
