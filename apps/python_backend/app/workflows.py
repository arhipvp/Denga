from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.ai_adapter import AiAdapter
from app.config import Settings, get_settings
from app.domain.draft_state import DraftLifecycleState, transition_draft_state
from app.domain.job_policy import build_job_dedupe_key
from app.logging_utils import logger
from app.models import (
    AiParseAttempt,
    AiParseAttemptType,
    Attachment,
    Category,
    CategoryType,
    ClarificationSession,
    ClarificationStatus,
    Job,
    PendingOperationReview,
    SourceMessage,
    SourceMessageStatus,
    SourceMessageType,
    TelegramAccount,
    Transaction,
    TransactionStatus,
    TransactionType,
    User,
    UserRole,
)
from app.observability import increment_metric, set_gauge
from app.repositories.category_repository import CategoryRepository
from app.repositories.draft_repository import DraftRepository
from app.repositories.settings_repository import SettingsRepository
from app.repositories.source_message_repository import SourceMessageRepository
from app.repositories.transaction_repository import TransactionRepository
from app.services_core import bootstrap_household_id, get_settings_payload
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import (
    CATEGORY_LEAF_PAGE_CALLBACK_PREFIX,
    CATEGORY_PARENT_CALLBACK_PREFIX,
    CATEGORY_PARENT_PAGE_CALLBACK_PREFIX,
    TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK,
    TELEGRAM_INCOME_CURRENT_MONTH_CALLBACK,
    apply_heuristics,
    build_category_picker_page,
    create_draft_keyboard,
    create_draft_payload,
    create_stats_submenu_reply_markup,
    get_missing_draft_fields,
    is_add_operation_menu_action,
    is_cancel_command,
    is_start_command,
    is_stats_menu_action,
    merge_draft_with_parsed,
    normalize_date,
    render_draft_text,
)
from app.telegram_stats import send_current_month_report
from app.telegram_types import ActiveCategory, ParsedTransaction, ReviewDraft, extract_message_text
from app.use_cases.jobs import enqueue_use_case_job
from app.use_cases.notifications import enqueue_notification_job as enqueue_notification_use_case
from app.use_cases.notifications import notify_transaction_event as notify_transaction_event_use_case
from app.use_cases.scheduled_backup import (
    maybe_enqueue_scheduled_backup as maybe_enqueue_scheduled_backup_use_case,
)
from app.use_cases.scheduled_backup import process_scheduled_backup as process_scheduled_backup_use_case


JOB_TYPE_TELEGRAM_UPDATE = "telegram_update"
JOB_TYPE_PARSE_SOURCE_MESSAGE = "parse_source_message"
JOB_TYPE_CLARIFICATION_REPARSE = "clarification_reparse"
JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS = "send_transaction_notifications"
JOB_TYPE_SCHEDULED_BACKUP = "scheduled_backup"
SCHEDULED_BACKUP_SCHEDULE = "0 0 12 */3 * *"


def load_active_categories(db: Session, type_: str | None = None) -> list[ActiveCategory]:
    return CategoryRepository(db).list_active(type_)


def upsert_telegram_user(db: Session, message: dict[str, Any]) -> User:
    return SourceMessageRepository(db).upsert_telegram_user(message)


def persist_attachments(db: Session, message: dict[str, Any], source_message_id: str, telegram: TelegramAdapter) -> list[Attachment]:
    return SourceMessageRepository(db).persist_attachments(
        message=message,
        source_message_id=source_message_id,
        get_file_metadata=telegram.get_file_metadata,
    )


def record_parse_attempt(
    db: Session,
    source_message_id: str,
    attempt_type: AiParseAttemptType,
    model: str,
    prompt: dict[str, Any],
    response_payload: dict[str, Any],
    success: bool = True,
) -> None:
    SourceMessageRepository(db).record_parse_attempt(
        source_message_id=source_message_id,
        attempt_type=attempt_type,
        model=model,
        prompt=prompt,
        response_payload=response_payload,
        success=success,
    )


def safe_parse_message(
    db: Session,
    *,
    source_message: SourceMessage,
    attempt_type: AiParseAttemptType,
    user_input: str,
    image_data_url: str | None,
    conversation_context: list[dict[str, str]],
) -> ParsedTransaction:
    settings = get_settings_payload(db)
    categories = load_active_categories(db)
    request = {
        "model": settings["aiModel"],
        "systemPrompt": settings["parsingPrompt"],
        "clarificationPrompt": settings["clarificationPrompt"],
        "categories": [item.display_path for item in categories],
        "householdCurrency": settings["defaultCurrency"],
        "currentDate": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "userInput": user_input,
        "conversationContext": conversation_context,
        "imageDataUrl": image_data_url,
    }
    ai = AiAdapter()
    prompt_snapshot = ai.build_prompt_snapshot(request)
    try:
        ai_parsed = ai.parse_transaction(request)
        parsed = apply_heuristics(
            ai_parsed,
            "\n".join([*(item["text"] for item in conversation_context), user_input]),
            categories,
            settings["defaultCurrency"],
        )
        record_parse_attempt(
            db,
            source_message.id,
            attempt_type,
            settings["aiModel"],
            prompt_snapshot,
            {
                "type": parsed.type,
                "amount": parsed.amount,
                "occurredAt": parsed.occurred_at,
                "categoryCandidate": parsed.category_candidate,
                "comment": parsed.comment,
                "confidence": parsed.confidence,
                "ambiguities": parsed.ambiguities,
                "followUpQuestion": parsed.follow_up_question,
                "resolvedCurrency": parsed.resolved_currency,
            },
        )
        return parsed
    except Exception as exc:
        fallback = apply_heuristics(
            ParsedTransaction(
                type=None,
                amount=None,
                occurred_at=None,
                category_candidate=None,
                comment=user_input or None,
                confidence=0.1,
                ambiguities=["type", "amount", "date", "category"],
                follow_up_question=None,
                resolved_currency=settings["defaultCurrency"],
            ),
            user_input,
            categories,
            settings["defaultCurrency"],
        )
        record_parse_attempt(
            db,
            source_message.id,
            attempt_type,
            settings["aiModel"],
            {**prompt_snapshot, "fallback": True},
            {
                "type": fallback.type,
                "amount": fallback.amount,
                "occurredAt": fallback.occurred_at,
                "categoryCandidate": fallback.category_candidate,
                "comment": fallback.comment,
                "confidence": fallback.confidence,
                "ambiguities": fallback.ambiguities,
                "followUpQuestion": fallback.follow_up_question,
                "resolvedCurrency": fallback.resolved_currency,
                "error": str(exc),
            },
            success=False,
        )
        return fallback


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
    review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
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


def enqueue_notification_job(db: Session, transaction_id: str, event: str, exclude_telegram_ids: list[str] | None = None) -> None:
    enqueue_notification_use_case(db, transaction_id, event, exclude_telegram_ids)


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


def apply_manual_edit(db: Session, draft_id: str, field: str, value: str, chat_id: str, telegram: TelegramAdapter, user_message_id: str | None = None) -> dict[str, Any]:
    review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
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


def begin_field_edit(db: Session, draft_id: str, field: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    draft = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
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
    draft_record = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
    review_draft = ReviewDraft.from_dict(draft_record.draft)
    categories = load_active_categories(db, review_draft.type)
    page_payload = build_category_picker_page(
        categories,
        requested_page,
        parent_id=parent_id,
        parent_page=parent_page,
    )
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


def confirm_draft(db: Session, draft_id: str, chat_id: str, message_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    review = db.execute(
        select(PendingOperationReview)
        .where(PendingOperationReview.id == draft_id)
        .options(joinedload(PendingOperationReview.author).selectinload(User.telegram_accounts))
    ).scalar_one()
    draft = ReviewDraft.from_dict(review.draft)
    missing = get_missing_draft_fields(draft)
    if missing:
        telegram.send_message(chat_id, f"Перед подтверждением нужно заполнить: {', '.join(missing)}.")
        render_or_send_draft_card(db, draft_id, chat_id, telegram)
        return {"accepted": True, "status": "missing_fields"}
    try:
        transaction = create_transaction_from_draft(db, review, draft)
    except RuntimeError as exc:
        telegram.send_message(chat_id, "Категория не соответствует типу операции." if str(exc) == "Category type does not match transaction type" else "Категория не найдена. Выберите заново.")
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


def handle_message_update(db: Session, message: dict[str, Any], raw_update: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    author = upsert_telegram_user(db, message)
    chat_id = str((message.get("chat") or {}).get("id"))
    text_value = extract_message_text(message)
    has_attachment = bool(message.get("photo") or message.get("document"))
    if is_start_command(text_value):
        telegram.send_message(chat_id, "Привет! Отправьте сообщение с операцией или фото чека.")
        return {"accepted": True, "status": "menu_shown", "authorId": author.id}
    if is_add_operation_menu_action(text_value):
        telegram.send_message(chat_id, "Отправьте сообщение с операцией или фото чека. Например: <b>Такси 12 EUR</b>.")
        return {"accepted": True, "status": "add_operation_prompt_shown", "authorId": author.id}
    if is_stats_menu_action(text_value):
        telegram.send_message(chat_id, "Выберите отчет:", create_stats_submenu_reply_markup())
        return {"accepted": True, "status": "stats_menu_shown", "authorId": author.id}

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
                return apply_manual_edit(db, existing_draft.id, existing_draft.pending_field, text_value, chat_id, telegram, str(message.get("message_id") or ""))
            DraftRepository(db).transition_review(
                existing_draft,
                current_state=DraftLifecycleState.PENDING_REVIEW,
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
    attachments = persist_attachments(db, message, source_message.id, telegram)
    logger.info("telegram", "message_received", "Telegram message received", {"sourceMessageId": source_message.id, "telegramMessageId": source_message.telegram_message_id, "authorId": author.id, "hasAttachment": has_attachment})
    parse_payload = {"sourceMessageId": source_message.id, "authorId": author.id, "chatId": chat_id, "inputText": text_value, "attachmentIds": [item.id for item in attachments]}
    enqueue_use_case_job(
        db,
        job_type=JOB_TYPE_PARSE_SOURCE_MESSAGE,
        payload=parse_payload,
        household_id=bootstrap_household_id(),
        dedupe_key=build_job_dedupe_key(JOB_TYPE_PARSE_SOURCE_MESSAGE, parse_payload),
    )
    return {"accepted": True, "status": "parse_enqueued"}


def process_parse_source_message(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    source_message = SourceMessageRepository(db).get_by_id(payload["sourceMessageId"])
    if not source_message:
        raise RuntimeError("Source message not found")
    first_attachment = source_message.attachments[0] if source_message.attachments else None
    image_data_url = (
        telegram.build_attachment_data_url(first_attachment.telegram_file_id, first_attachment.telegram_file_path, first_attachment.mime_type)
        if first_attachment
        else None
    )
    parsed = safe_parse_message(
        db,
        source_message=source_message,
        attempt_type=AiParseAttemptType.INITIAL_PARSE,
        user_input=payload.get("inputText") or source_message.text or "",
        image_data_url=image_data_url,
        conversation_context=[],
    )
    categories = load_active_categories(db, parsed.type)
    draft = create_draft_payload(
        parsed,
        payload.get("inputText") or source_message.text or "",
        SettingsRepository(db).get_payload()["defaultCurrency"],
        categories,
    )
    review = DraftRepository(db).create_review(
        source_message_id=source_message.id,
        author_id=payload.get("authorId"),
        draft_payload=draft.to_dict(),
    )
    review = DraftRepository(db).get_by_id(review.id) or review
    DraftRepository(db).transition_review(
        review,
        current_state=DraftLifecycleState.PARSED,
        next_state=DraftLifecycleState.PENDING_REVIEW,
    )
    if get_missing_draft_fields(draft):
        DraftRepository(db).transition_review(
            review,
            current_state=DraftLifecycleState.PENDING_REVIEW,
            next_state=DraftLifecycleState.NEEDS_CLARIFICATION,
        )
        increment_metric("clarification.entered")
        upsert_clarification_session(db, source_message.id, draft)
    render_or_send_draft_card(db, review.id, payload["chatId"], telegram)
    return {"accepted": True, "status": "pending_review", "draftId": review.id}


def reparse_draft_with_clarification(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    review = DraftRepository(db).get_by_id(payload["draftId"])
    if not review:
        raise RuntimeError("Draft not found")
    current_draft = ReviewDraft.from_dict(review.draft)
    first_attachment = review.source_message.attachments[0] if review.source_message and review.source_message.attachments else None
    image_data_url = (
        telegram.build_attachment_data_url(first_attachment.telegram_file_id, first_attachment.telegram_file_path, first_attachment.mime_type)
        if first_attachment
        else None
    )
    parsed = safe_parse_message(
        db,
        source_message=review.source_message,
        attempt_type=AiParseAttemptType.CLARIFICATION_REPARSE,
        user_input=payload["userText"],
        image_data_url=image_data_url,
        conversation_context=[
            {"role": "assistant", "text": current_draft.follow_up_question or render_draft_text(current_draft, False)},
            {"role": "user", "text": payload["userText"]},
        ],
    )
    categories = load_active_categories(db, parsed.type)
    next_draft = merge_draft_with_parsed(
        current_draft,
        parsed,
        payload["userText"],
        SettingsRepository(db).get_payload()["defaultCurrency"],
        categories,
    )
    review.draft = next_draft.to_dict()
    review.pending_field = None
    review.active_picker_message_id = None
    db.commit()
    if get_missing_draft_fields(next_draft):
        DraftRepository(db).transition_review(
            review,
            current_state=DraftLifecycleState.CLARIFICATION_ENQUEUED,
            next_state=DraftLifecycleState.NEEDS_CLARIFICATION,
        )
        increment_metric("clarification.entered")
        upsert_clarification_session(db, review.source_message_id, next_draft)
    else:
        DraftRepository(db).transition_review(
            review,
            current_state=DraftLifecycleState.CLARIFICATION_ENQUEUED,
            next_state=DraftLifecycleState.PENDING_REVIEW,
        )
        increment_metric("clarification.resolved")
        resolve_clarification_session(db, review.source_message_id, payload["userText"])
    render_or_send_draft_card(db, review.id, payload["chatId"], telegram)
    return {"accepted": True, "status": "pending_review"}


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
        category = db.execute(select(Category).where(Category.id == category_id).options(joinedload(Category.parent))).scalar_one_or_none()
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
        return show_category_page(
            db,
            draft.id,
            chat_id,
            int(message_id),
            0,
            telegram,
            parent_id=parent_id,
            parent_page=int(parent_page_value or "0"),
        )
    if data.startswith(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        page = int(data.replace(CATEGORY_PARENT_PAGE_CALLBACK_PREFIX, "") or "0")
        return show_category_page(
            db,
            draft.id,
            chat_id,
            int(message_id),
            page,
            telegram,
            parent_id=None,
            parent_page=page,
        )
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


def notify_transaction_event(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    return notify_transaction_event_use_case(db, payload, telegram)


def route_telegram_update(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    if payload.get("callback_query"):
        return handle_callback_query(db, payload["callback_query"], telegram)
    if not payload.get("message"):
        return {"accepted": True, "ignored": True}
    return handle_message_update(db, payload["message"], payload, telegram)


def maybe_enqueue_scheduled_backup(db: Session, settings: Settings | None = None) -> None:
    maybe_enqueue_scheduled_backup_use_case(db, settings)


def process_scheduled_backup(db: Session, telegram: TelegramAdapter) -> dict[str, Any]:
    return process_scheduled_backup_use_case(db, telegram)
