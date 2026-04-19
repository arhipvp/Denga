from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domain.draft_state import DraftLifecycleState
from app.domain.job_policy import build_job_dedupe_key
from app.logging_utils import logger
from app.models import SourceMessageStatus, SourceMessageType
from app.observability import increment_metric
from app.repositories.draft_repository import DraftRepository
from app.repositories.source_message_repository import SourceMessageRepository
from app.repositories.transaction_edit_session_repository import TransactionEditSessionRepository
from app.services_core import bootstrap_household_id
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import (
    CATEGORY_LEAF_PAGE_CALLBACK_PREFIX,
    CATEGORY_PARENT_CALLBACK_PREFIX,
    CATEGORY_PARENT_PAGE_CALLBACK_PREFIX,
    create_stats_submenu_reply_markup,
    is_add_operation_menu_action,
    is_cancel_command,
    is_edit_operation_menu_action,
    is_start_command,
    is_stats_menu_action,
)
from app.telegram_types import extract_message_text
from app.use_cases.draft_review import apply_manual_edit, cancel_draft, handle_callback_query
from app.use_cases.jobs import enqueue_use_case_job
from app.use_cases.parse_pipeline import process_parse_source_message, reparse_draft_with_clarification
from app.use_cases.transaction_edit import (
    apply_transaction_manual_edit,
    handle_transaction_edit_callback_query,
    has_blocking_draft_review,
    start_transaction_edit_flow,
)


JOB_TYPE_TELEGRAM_UPDATE = "telegram_update"
JOB_TYPE_PARSE_SOURCE_MESSAGE = "parse_source_message"
JOB_TYPE_CLARIFICATION_REPARSE = "clarification_reparse"


def handle_message_update(db: Session, message: dict[str, Any], raw_update: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    author = SourceMessageRepository(db).upsert_telegram_user(message)
    chat_id = str((message.get("chat") or {}).get("id"))
    text_value = extract_message_text(message)
    has_attachment = bool(message.get("photo") or message.get("document"))
    active_edit_session = TransactionEditSessionRepository(db).get_active_for_author(author.id)
    if is_start_command(text_value):
        telegram.send_message(chat_id, "Привет! Отправьте сообщение с операцией или фото чека.")
        return {"accepted": True, "status": "menu_shown", "authorId": author.id}
    if active_edit_session and is_add_operation_menu_action(text_value):
        telegram.send_message(chat_id, "Сначала завершите редактирование текущей операции или нажмите «Отменить».")
        return {"accepted": True, "status": "edit_session_blocks_new_operation", "authorId": author.id}
    if is_add_operation_menu_action(text_value):
        telegram.send_message(chat_id, "Отправьте сообщение с операцией или фото чека. Например: <b>Такси 12 EUR</b>.")
        return {"accepted": True, "status": "add_operation_prompt_shown", "authorId": author.id}
    if is_stats_menu_action(text_value):
        telegram.send_message(chat_id, "Выберите отчет:", create_stats_submenu_reply_markup())
        return {"accepted": True, "status": "stats_menu_shown", "authorId": author.id}
    if is_edit_operation_menu_action(text_value):
        if has_blocking_draft_review(db, author.id):
            telegram.send_message(chat_id, "Сначала завершите или отмените текущий черновик операции.")
            return {"accepted": True, "status": "draft_blocks_edit", "authorId": author.id}
        return start_transaction_edit_flow(db, author.id, chat_id, telegram)

    if active_edit_session:
        if has_attachment:
            telegram.send_message(chat_id, "Сначала завершите редактирование текущей операции или нажмите «Отменить».")
            return {"accepted": True, "status": "edit_session_active", "authorId": author.id}
        if is_cancel_command(text_value):
            telegram.send_message(chat_id, "Нажмите кнопку «Отменить» под карточкой операции, чтобы выйти из редактирования.")
            return {"accepted": True, "status": "edit_cancel_prompted", "authorId": author.id}
        if active_edit_session.pending_field:
            return apply_transaction_manual_edit(
                db,
                active_edit_session.id,
                active_edit_session.pending_field,
                text_value,
                chat_id,
                telegram,
                str(message.get("message_id") or ""),
            )
        telegram.send_message(chat_id, "Используйте кнопки под карточкой операции или завершите текущее редактирование.")
        return {"accepted": True, "status": "edit_session_waiting_buttons", "authorId": author.id}

    existing_draft = DraftRepository(db).get_active_for_author(author.id)
    if existing_draft:
        if has_attachment and not existing_draft.pending_field:
            cancel_draft(db, existing_draft, chat_id, telegram)
            telegram.send_message(chat_id, "Предыдущий черновик закрыт. Обрабатываю новый чек как отдельную операцию.")
        else:
            if is_cancel_command(text_value):
                cancel_draft(db, existing_draft, chat_id, telegram)
                telegram.send_message(chat_id, "Черновик отменен. Можете отправить новую операцию.")
                return {"accepted": True, "status": "cancelled"}
            if existing_draft.pending_field:
                return apply_manual_edit(
                    db,
                    existing_draft.id,
                    existing_draft.pending_field,
                    text_value,
                    chat_id,
                    telegram,
                    str(message.get("message_id") or ""),
                )
            DraftRepository(db).transition_review(
                existing_draft,
                current_state=DraftLifecycleState.NEEDS_CLARIFICATION
                if existing_draft.status == SourceMessageStatus.NEEDS_CLARIFICATION
                else DraftLifecycleState.PENDING_REVIEW,
                next_state=DraftLifecycleState.CLARIFICATION_ENQUEUED,
            )
            clarification_payload = {"draftId": existing_draft.id, "userText": text_value, "chatId": chat_id}
            enqueue_use_case_job(
                db,
                job_type=JOB_TYPE_CLARIFICATION_REPARSE,
                payload=clarification_payload,
                household_id=bootstrap_household_id(),
                dedupe_key=build_job_dedupe_key(JOB_TYPE_CLARIFICATION_REPARSE, clarification_payload),
            )
            increment_metric("clarification.enqueued")
            return {"accepted": True, "status": "clarification_enqueued"}

    telegram_message_id = str(message.get("message_id"))
    source_message_repo = SourceMessageRepository(db)
    source_message = source_message_repo.get_by_telegram_message_id(telegram_message_id)
    if source_message:
        source_message.raw_payload = raw_update
        db.commit()
        return {"accepted": True, "status": "duplicate"}

    source_message = source_message_repo.create_received(
        author_id=author.id,
        telegram_message_id=telegram_message_id,
        telegram_chat_id=chat_id,
        type_=SourceMessageType.TELEGRAM_RECEIPT if has_attachment else SourceMessageType.TELEGRAM_TEXT,
        text=text_value or None,
        raw_payload=raw_update,
    )
    attachments = source_message_repo.persist_attachments(
        message=message,
        source_message_id=source_message.id,
        get_file_metadata=telegram.get_file_metadata,
    )
    logger.info(
        "telegram",
        "message_received",
        "Telegram message received",
        {
            "sourceMessageId": source_message.id,
            "telegramMessageId": source_message.telegram_message_id,
            "authorId": author.id,
            "hasAttachment": has_attachment,
        },
    )
    parse_payload = {
        "sourceMessageId": source_message.id,
        "authorId": author.id,
        "chatId": chat_id,
        "inputText": text_value,
        "attachmentIds": [item.id for item in attachments],
    }
    enqueue_use_case_job(
        db,
        job_type=JOB_TYPE_PARSE_SOURCE_MESSAGE,
        payload=parse_payload,
        household_id=bootstrap_household_id(),
        dedupe_key=build_job_dedupe_key(JOB_TYPE_PARSE_SOURCE_MESSAGE, parse_payload),
    )
    return {"accepted": True, "status": "parse_enqueued"}


def route_telegram_update(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    if payload.get("callback_query"):
        data = str((payload["callback_query"] or {}).get("data") or "")
        author_telegram_id = str(((payload["callback_query"] or {}).get("from") or {}).get("id") or "")
        has_active_edit_session = bool(
            author_telegram_id and TransactionEditSessionRepository(db).get_active_for_telegram_account(author_telegram_id)
        )
        if data.startswith("tx-edit:"):
            return handle_transaction_edit_callback_query(db, payload["callback_query"], telegram)
        if has_active_edit_session and data.startswith(
            (CATEGORY_PARENT_CALLBACK_PREFIX, CATEGORY_PARENT_PAGE_CALLBACK_PREFIX, CATEGORY_LEAF_PAGE_CALLBACK_PREFIX)
        ):
            return handle_transaction_edit_callback_query(db, payload["callback_query"], telegram)
        return handle_callback_query(db, payload["callback_query"], telegram)
    if not payload.get("message"):
        return {"accepted": True, "ignored": True}
    return handle_message_update(db, payload["message"], payload, telegram)
