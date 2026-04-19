from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Category, SourceMessageStatus, TelegramAccount, Transaction, TransactionType
from app.repositories.category_repository import CategoryRepository
from app.repositories.draft_repository import DraftRepository
from app.repositories.transaction_edit_session_repository import TransactionEditSessionRepository
from app.repositories.transaction_repository import TransactionRepository
from app.schemas import TransactionUpdateRequest
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import (
    CATEGORY_LEAF_PAGE_CALLBACK_PREFIX,
    CATEGORY_PARENT_CALLBACK_PREFIX,
    CATEGORY_PARENT_PAGE_CALLBACK_PREFIX,
    build_category_picker_page,
    build_transaction_edit_list,
    create_transaction_edit_keyboard,
    get_missing_draft_fields,
    normalize_date,
    render_transaction_edit_text,
)
from app.telegram_types import ReviewDraft
from app.use_cases.draft_review import clear_active_picker_message
from app.use_cases.transactions import cancel_transaction, update_transaction


def _telegram_account_owner_id(db: Session, telegram_id: str) -> str | None:
    return db.execute(select(TelegramAccount.user_id).where(TelegramAccount.telegram_id == telegram_id)).scalar_one_or_none()


def _transaction_to_draft(transaction: Transaction) -> ReviewDraft:
    category_name = (
        f"{transaction.category.parent.name} / {transaction.category.name}"
        if transaction.category and transaction.category.parent
        else (transaction.category.name if transaction.category else None)
    )
    return ReviewDraft(
        type="income" if transaction.type == TransactionType.INCOME else "expense",
        amount=float(transaction.amount),
        occurred_at=transaction.occurred_at.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        category_id=transaction.category_id,
        category_name=category_name,
        comment=transaction.comment,
        currency=transaction.currency,
        confidence=1,
        ambiguities=[],
        follow_up_question=None,
        source_text=None,
    )


def _updated_payload_to_draft(payload: dict[str, Any]) -> ReviewDraft:
    category = payload.get("category") or {}
    return ReviewDraft(
        type=payload.get("type"),
        amount=float(payload["amount"]) if payload.get("amount") is not None else None,
        occurred_at=payload.get("occurredAt"),
        category_id=payload.get("categoryId"),
        category_name=category.get("displayPath"),
        comment=payload.get("comment"),
        currency=payload.get("currency"),
        confidence=1,
        ambiguities=[],
        follow_up_question=None,
        source_text=None,
    )


def _load_transaction_for_author(db: Session, author_id: str, transaction_id: str) -> Transaction | None:
    return TransactionRepository(db).get_by_id_for_author(transaction_id, author_id)


def render_or_send_transaction_edit_card(db: Session, session_id: str, chat_id: str, telegram: TelegramAdapter) -> None:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    draft = ReviewDraft.from_dict(session.draft)
    text_value = render_transaction_edit_text(draft)
    active_picker_id = session.active_picker_message_id
    if active_picker_id:
        session.active_picker_message_id = None
        TransactionEditSessionRepository(db).save(session)
        clear_active_picker_message(chat_id, active_picker_id, telegram)
    keyboard = create_transaction_edit_keyboard()
    if session.last_bot_message_id and telegram.edit_message(chat_id, int(session.last_bot_message_id), text_value, keyboard):
        return
    sent = telegram.send_message(chat_id, text_value, keyboard)
    session.last_bot_message_id = str(sent.get("message_id") or 0)
    TransactionEditSessionRepository(db).save(session)


def start_transaction_edit_flow(db: Session, author_id: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    active_session = TransactionEditSessionRepository(db).get_active_for_author(author_id)
    if active_session:
        telegram.send_message(chat_id, "У вас уже открыто редактирование операции. Завершите его или нажмите «Отменить».")
        render_or_send_transaction_edit_card(db, active_session.id, chat_id, telegram)
        return {"accepted": True, "status": "edit_session_active"}
    payload = build_transaction_edit_list(TransactionRepository(db).list_recent_for_author(author_id, limit=10))
    telegram.send_message(chat_id, payload["text"], payload["replyMarkup"])
    return {"accepted": True, "status": "edit_list_shown"}


def apply_transaction_manual_edit(
    db: Session,
    session_id: str,
    field: str,
    value: str,
    chat_id: str,
    telegram: TelegramAdapter,
    user_message_id: str | None = None,
) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    draft = ReviewDraft.from_dict(session.draft)
    active_picker_id = session.active_picker_message_id
    last_bot_message_id = session.last_bot_message_id
    if field == "amount":
        import re

        match = re.search(r"\d+(?:\.\d+)?", value.replace(",", "."))
        draft.amount = float(match.group(0)) if match else None
    elif field == "date":
        draft.occurred_at = normalize_date(value)
    elif field == "comment":
        draft.comment = value
    session.draft = draft.to_dict()
    session.pending_field = None
    session.active_picker_message_id = None
    TransactionEditSessionRepository(db).save(session)
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    if user_message_id:
        try:
            telegram.delete_message(chat_id, int(user_message_id))
        except (TypeError, ValueError):
            pass
    if last_bot_message_id:
        clear_active_picker_message(chat_id, last_bot_message_id, telegram)
    sent = telegram.send_message(chat_id, render_transaction_edit_text(draft), create_transaction_edit_keyboard())
    session.last_bot_message_id = str(sent.get("message_id") or 0)
    TransactionEditSessionRepository(db).save(session)
    return {"accepted": True, "status": "editing"}


def show_transaction_category_page(
    db: Session,
    session_id: str,
    chat_id: str,
    message_id: int | None,
    requested_page: int,
    telegram: TelegramAdapter,
    *,
    parent_id: str | None,
    parent_page: int,
) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    draft = ReviewDraft.from_dict(session.draft)
    categories = CategoryRepository(db).list_active(draft.type)
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
        session.active_picker_message_id = str(result.get("message_id") or 0)
    else:
        session.active_picker_message_id = str(message_id)
        telegram.edit_message(chat_id, message_id, page_payload["text"], page_payload["replyMarkup"])
    TransactionEditSessionRepository(db).save(session)
    return {"accepted": True, "status": "editing_category"}


def begin_transaction_field_edit(db: Session, session_id: str, field: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    active_picker_id = session.active_picker_message_id
    if field == "type":
        session.pending_field = None
        session.active_picker_message_id = None
        TransactionEditSessionRepository(db).save(session)
        clear_active_picker_message(chat_id, active_picker_id, telegram)
        result = telegram.send_message(
            chat_id,
            "Выберите тип операции:",
            {"inline_keyboard": [[{"text": "Доход", "callback_data": "tx-edit:set-type:income"}, {"text": "Расход", "callback_data": "tx-edit:set-type:expense"}]]},
        )
        session.active_picker_message_id = str(result.get("message_id") or 0)
        TransactionEditSessionRepository(db).save(session)
        return {"accepted": True, "status": "editing_type"}
    if field == "category":
        session.pending_field = None
        session.active_picker_message_id = None
        TransactionEditSessionRepository(db).save(session)
        clear_active_picker_message(chat_id, active_picker_id, telegram)
        return show_transaction_category_page(db, session_id, chat_id, None, 0, telegram, parent_id=None, parent_page=0)
    prompts = {"amount": "Введите новую сумму.", "date": 'Введите новую дату. Можно написать "сегодня" или "2026-03-31".', "comment": "Введите новый комментарий."}
    session.pending_field = field
    session.active_picker_message_id = None
    TransactionEditSessionRepository(db).save(session)
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    result = telegram.send_message(chat_id, prompts.get(field, "Введите новое значение."))
    session.active_picker_message_id = str(result.get("message_id") or 0)
    TransactionEditSessionRepository(db).save(session)
    return {"accepted": True, "status": "awaiting_edit"}


def save_transaction_edit_session(db: Session, session_id: str, chat_id: str, message_id: int, telegram: TelegramAdapter) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    draft = ReviewDraft.from_dict(session.draft)
    missing = get_missing_draft_fields(draft)
    if missing:
        telegram.send_message(chat_id, f"Перед сохранением нужно заполнить: {', '.join(missing)}.")
        render_or_send_transaction_edit_card(db, session.id, chat_id, telegram)
        return {"accepted": True, "status": "missing_fields"}
    try:
        updated = update_transaction(
            db,
            session.transaction_id,
            TransactionUpdateRequest(
                type=draft.type,
                amount=draft.amount,
                occurredAt=datetime.fromisoformat((draft.occurred_at or "").replace("Z", "+00:00")),
                categoryId=draft.category_id,
                comment=draft.comment,
            ),
        )
    except (LookupError, ValueError):
        telegram.send_message(chat_id, "Не удалось сохранить изменения. Проверьте тип, дату и категорию операции.")
        return {"accepted": True, "status": "invalid_update"}
    clear_active_picker_message(chat_id, session.active_picker_message_id, telegram)
    session.last_bot_message_id = str(message_id)
    session.active_picker_message_id = None
    session.pending_field = None
    TransactionEditSessionRepository(db).complete(session)
    final_text = "✅ Операция обновлена\n\n" + render_transaction_edit_text(_updated_payload_to_draft(updated))
    if not telegram.edit_message(chat_id, message_id, final_text):
        telegram.clear_inline_keyboard(chat_id, message_id)
        telegram.send_message(chat_id, final_text)
    return {"accepted": True, "status": "updated", "transactionId": session.transaction_id}


def cancel_transaction_edit_session(db: Session, session_id: str, chat_id: str, message_id: int, telegram: TelegramAdapter) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    clear_active_picker_message(chat_id, session.active_picker_message_id, telegram)
    TransactionEditSessionRepository(db).cancel(session)
    if not telegram.edit_message(chat_id, message_id, "Редактирование операции отменено."):
        telegram.send_message(chat_id, "Редактирование операции отменено.")
    return {"accepted": True, "status": "cancelled"}


def confirm_delete_transaction_edit_session(db: Session, session_id: str, chat_id: str, message_id: int, telegram: TelegramAdapter) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    telegram.edit_message(
        chat_id,
        message_id,
        "Удалить операцию? Это действие отменит запись и уберет ее из списка редактируемых.",
        create_transaction_edit_keyboard(confirm_delete=True),
    )
    session.last_bot_message_id = str(message_id)
    TransactionEditSessionRepository(db).save(session)
    return {"accepted": True, "status": "confirming_delete"}


def delete_transaction_from_session(db: Session, session_id: str, chat_id: str, message_id: int, telegram: TelegramAdapter) -> dict[str, Any]:
    session = TransactionEditSessionRepository(db).get_by_id(session_id)
    if session is None:
        raise RuntimeError("Edit session not found")
    cancel_transaction(db, session.transaction_id)
    clear_active_picker_message(chat_id, session.active_picker_message_id, telegram)
    TransactionEditSessionRepository(db).complete(session)
    if not telegram.edit_message(chat_id, message_id, "🗑️ Операция удалена."):
        telegram.clear_inline_keyboard(chat_id, message_id)
        telegram.send_message(chat_id, "🗑️ Операция удалена.")
    return {"accepted": True, "status": "deleted", "transactionId": session.transaction_id}


def open_transaction_for_edit(db: Session, author_id: str, transaction_id: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    active_session = TransactionEditSessionRepository(db).get_active_for_author(author_id)
    if active_session and active_session.transaction_id != transaction_id:
        telegram.send_message(chat_id, "Сначала завершите или отмените текущее редактирование.")
        render_or_send_transaction_edit_card(db, active_session.id, chat_id, telegram)
        return {"accepted": True, "status": "edit_session_active"}
    transaction = _load_transaction_for_author(db, author_id, transaction_id)
    if transaction is None:
        telegram.send_message(chat_id, "Операция не найдена или недоступна для редактирования.")
        return {"accepted": True, "status": "transaction_not_found"}
    if active_session:
        active_session.transaction_id = transaction.id
        active_session.draft = _transaction_to_draft(transaction).to_dict()
        active_session.pending_field = None
        active_session.active_picker_message_id = None
        TransactionEditSessionRepository(db).save(active_session)
        render_or_send_transaction_edit_card(db, active_session.id, chat_id, telegram)
        return {"accepted": True, "status": "editing"}
    session = TransactionEditSessionRepository(db).create(
        author_id=author_id,
        transaction_id=transaction.id,
        draft=_transaction_to_draft(transaction).to_dict(),
    )
    render_or_send_transaction_edit_card(db, session.id, chat_id, telegram)
    return {"accepted": True, "status": "editing"}


def has_blocking_draft_review(db: Session, author_id: str) -> bool:
    active_draft = DraftRepository(db).get_active_for_author(author_id)
    return active_draft is not None and active_draft.status in {
        SourceMessageStatus.PENDING_REVIEW,
        SourceMessageStatus.NEEDS_CLARIFICATION,
    }


def handle_transaction_edit_callback_query(db: Session, callback: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    data = callback.get("data") or ""
    chat_id = str(((callback.get("message") or {}).get("chat") or {}).get("id") or callback.get("from", {}).get("id"))
    message_id = int((callback.get("message") or {}).get("message_id") or 0)
    author_telegram_id = str((callback.get("from") or {}).get("id"))
    if data.startswith("tx-edit:pick:"):
        owner_id = _telegram_account_owner_id(db, author_telegram_id)
        if not owner_id:
            telegram.answer_callback_query(callback["id"], "Пользователь не найден")
            return {"accepted": True, "ignored": True}
        telegram.answer_callback_query(callback["id"])
        return open_transaction_for_edit(db, owner_id, data.replace("tx-edit:pick:", ""), chat_id, telegram)

    session = TransactionEditSessionRepository(db).get_active_for_telegram_account(author_telegram_id)
    if not session:
        telegram.answer_callback_query(callback["id"], "Сессия редактирования не найдена")
        return {"accepted": True, "ignored": True}

    if data == "tx-edit:save":
        telegram.answer_callback_query(callback["id"])
        return save_transaction_edit_session(db, session.id, chat_id, message_id, telegram)
    if data == "tx-edit:cancel":
        telegram.answer_callback_query(callback["id"])
        return cancel_transaction_edit_session(db, session.id, chat_id, message_id, telegram)
    if data.startswith("tx-edit:field:"):
        telegram.answer_callback_query(callback["id"])
        return begin_transaction_field_edit(db, session.id, data.replace("tx-edit:field:", ""), chat_id, telegram)
    if data.startswith("tx-edit:set-type:"):
        telegram.answer_callback_query(callback["id"])
        draft = ReviewDraft.from_dict(session.draft)
        draft.type = data.replace("tx-edit:set-type:", "")
        draft.category_id = None
        draft.category_name = None
        clear_active_picker_message(chat_id, session.active_picker_message_id, telegram)
        session.draft = draft.to_dict()
        session.active_picker_message_id = None
        session.pending_field = None
        TransactionEditSessionRepository(db).save(session)
        render_or_send_transaction_edit_card(db, session.id, chat_id, telegram)
        return {"accepted": True, "status": "editing"}
    if data.startswith("tx-edit:set-category:"):
        category_id = data.replace("tx-edit:set-category:", "")
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
        draft = ReviewDraft.from_dict(session.draft)
        draft.category_id = category.id
        draft.category_name = f"{category.parent.name if category.parent else 'Без родителя'} / {category.name}"
        clear_active_picker_message(chat_id, session.active_picker_message_id, telegram)
        session.draft = draft.to_dict()
        session.active_picker_message_id = None
        session.pending_field = None
        TransactionEditSessionRepository(db).save(session)
        render_or_send_transaction_edit_card(db, session.id, chat_id, telegram)
        return {"accepted": True, "status": "editing"}
    if data == "tx-edit:delete:confirm":
        telegram.answer_callback_query(callback["id"])
        return confirm_delete_transaction_edit_session(db, session.id, chat_id, message_id, telegram)
    if data == "tx-edit:delete:cancel":
        telegram.answer_callback_query(callback["id"])
        render_or_send_transaction_edit_card(db, session.id, chat_id, telegram)
        return {"accepted": True, "status": "editing"}
    if data == "tx-edit:delete:apply":
        telegram.answer_callback_query(callback["id"])
        return delete_transaction_from_session(db, session.id, chat_id, message_id, telegram)
    if data.startswith(CATEGORY_PARENT_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        parent_payload = data.replace(CATEGORY_PARENT_CALLBACK_PREFIX, "")
        parent_id, _, parent_page_value = parent_payload.partition(":")
        return show_transaction_category_page(
            db,
            session.id,
            chat_id,
            message_id,
            0,
            telegram,
            parent_id=parent_id,
            parent_page=int(parent_page_value or "0"),
        )
    if data.startswith(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        page = int(data.replace(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX, "") or "0")
        return show_transaction_category_page(
            db,
            session.id,
            chat_id,
            message_id,
            page,
            telegram,
            parent_id=None,
            parent_page=page,
        )
    if data.startswith(CATEGORY_LEAF_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        payload = data.replace(CATEGORY_LEAF_PAGE_CALLBACK_PREFIX, "")
        parent_id, parent_page_value, page_value = (payload.split(":", 2) + ["0", "0"])[:3]
        return show_transaction_category_page(
            db,
            session.id,
            chat_id,
            message_id,
            int(page_value or "0"),
            telegram,
            parent_id=parent_id,
            parent_page=int(parent_page_value or "0"),
        )
    telegram.answer_callback_query(callback["id"], "Неизвестное действие")
    return {"accepted": True, "ignored": True}
