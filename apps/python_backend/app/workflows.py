from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.ai_adapter import AiAdapter
from app.config import Settings, get_settings
from app.jobs import enqueue_job
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
from app.services_core import bootstrap_household_id, get_settings_payload
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import (
    CATEGORY_PAGE_CALLBACK_PREFIX,
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


JOB_TYPE_TELEGRAM_UPDATE = "telegram_update"
JOB_TYPE_PARSE_SOURCE_MESSAGE = "parse_source_message"
JOB_TYPE_CLARIFICATION_REPARSE = "clarification_reparse"
JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS = "send_transaction_notifications"
JOB_TYPE_SCHEDULED_BACKUP = "scheduled_backup"
SCHEDULED_BACKUP_SCHEDULE = "0 0 12 */3 * *"


def load_active_categories(db: Session, type_: str | None = None) -> list[ActiveCategory]:
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
    rows = list(db.execute(query).scalars())
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
                display_path=f"{item.parent.name} / {item.name}",
            )
        )
    result.sort(key=lambda item: item.display_path.lower())
    return result


def upsert_telegram_user(db: Session, message: dict[str, Any]) -> User:
    from_data = message.get("from") or {}
    telegram_id = str(from_data.get("id") or f"chat-{message.get('chat', {}).get('id')}")
    account = db.execute(
        select(TelegramAccount).where(TelegramAccount.telegram_id == telegram_id).options(joinedload(TelegramAccount.user))
    ).scalar_one_or_none()
    if account and account.user:
        account.username = from_data.get("username")
        account.first_name = from_data.get("first_name")
        account.last_name = from_data.get("last_name")
        account.is_active = True
        db.commit()
        return account.user
    user = User(
        household_id=bootstrap_household_id(),
        display_name=" ".join(item for item in (from_data.get("first_name"), from_data.get("last_name")) if item)
        or from_data.get("username")
        or f"Telegram {telegram_id}",
        role=UserRole.MEMBER,
    )
    db.add(user)
    db.flush()
    account = TelegramAccount(
        user_id=user.id,
        telegram_id=telegram_id,
        username=from_data.get("username"),
        first_name=from_data.get("first_name"),
        last_name=from_data.get("last_name"),
        is_active=True,
    )
    db.add(account)
    db.commit()
    db.refresh(user)
    return user


def persist_attachments(db: Session, message: dict[str, Any], source_message_id: str, telegram: TelegramAdapter) -> list[Attachment]:
    document = message.get("document") or {}
    photos = message.get("photo") or []
    file_id = document.get("file_id") or (photos[-1].get("file_id") if photos else None)
    if not file_id:
        return []
    file_meta = telegram.get_file_metadata(file_id)
    attachment = Attachment(
        source_message_id=source_message_id,
        telegram_file_id=file_id,
        telegram_file_path=file_meta.get("file_path"),
        mime_type=document.get("mime_type"),
        original_name=document.get("file_name"),
        local_path=None,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return [attachment]


def record_parse_attempt(
    db: Session,
    source_message_id: str,
    attempt_type: AiParseAttemptType,
    model: str,
    prompt: dict[str, Any],
    response_payload: dict[str, Any],
    success: bool = True,
) -> None:
    db.add(
        AiParseAttempt(
            source_message_id=source_message_id,
            attempt_type=attempt_type,
            provider="polza.ai",
            model=model,
            prompt=__import__("json").dumps(prompt, ensure_ascii=False),
            response_payload=response_payload,
            success=success,
        )
    )
    db.commit()


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
    session = db.execute(select(ClarificationSession).where(ClarificationSession.source_message_id == source_message_id)).scalar_one_or_none()
    question = draft.follow_up_question or "Пожалуйста, уточните недостающие поля операции."
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=int(get_settings_payload(db)["clarificationTimeoutMinutes"]))
    if session:
        session.status = ClarificationStatus.OPEN
        session.question = question
        session.expires_at = expires_at
    else:
        db.add(
            ClarificationSession(
                source_message_id=source_message_id,
                status=ClarificationStatus.OPEN,
                question=question,
                answer=None,
                conversation=[],
                expires_at=expires_at,
                resolved_at=None,
            )
        )
    db.commit()


def resolve_clarification_session(db: Session, source_message_id: str, answer: str) -> None:
    session = db.execute(select(ClarificationSession).where(ClarificationSession.source_message_id == source_message_id)).scalar_one_or_none()
    if not session:
        return
    conversation = list(session.conversation or [])
    conversation.append({"role": "user", "text": answer, "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")})
    session.status = ClarificationStatus.RESOLVED
    session.answer = answer
    session.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    session.conversation = conversation
    db.commit()


def create_transaction_from_draft(db: Session, review: PendingOperationReview, draft: ReviewDraft) -> Transaction:
    category = db.execute(select(Category).where(Category.id == draft.category_id).options(joinedload(Category.parent))).scalar_one_or_none()
    if not category or category.household_id != bootstrap_household_id():
        raise RuntimeError("Category not found")
    if category.parent_id is None:
        raise RuntimeError("Transactions can only use subcategories")
    expected = CategoryType.INCOME if draft.type == "income" else CategoryType.EXPENSE
    if category.type != expected:
        raise RuntimeError("Category type does not match transaction type")
    settings = get_settings_payload(db)
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
    db.add(transaction)
    source_message = db.execute(select(SourceMessage).where(SourceMessage.id == review.source_message_id)).scalar_one()
    source_message.status = SourceMessageStatus.PARSED
    review.status = SourceMessageStatus.PARSED
    review.pending_field = None
    review.active_picker_message_id = None
    db.commit()
    db.refresh(transaction)
    return transaction


def enqueue_notification_job(db: Session, transaction_id: str, event: str, exclude_telegram_ids: list[str] | None = None) -> None:
    enqueue_job(
        db,
        job_type=JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS,
        payload={"transactionId": transaction_id, "event": event, "excludeTelegramIds": exclude_telegram_ids or []},
        household_id=bootstrap_household_id(),
    )


def cancel_draft(db: Session, review: PendingOperationReview, chat_id: str | None, telegram: TelegramAdapter) -> dict[str, Any]:
    active_picker_id = review.active_picker_message_id
    review.status = SourceMessageStatus.CANCELLED
    review.active_picker_message_id = None
    review.pending_field = None
    source_message = db.execute(select(SourceMessage).where(SourceMessage.id == review.source_message_id)).scalar_one()
    source_message.status = SourceMessageStatus.CANCELLED
    db.commit()
    clear_active_picker_message(chat_id, active_picker_id, telegram)
    return {"accepted": True, "status": "cancelled"}


def apply_manual_edit(db: Session, draft_id: str, field: str, value: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
    draft = ReviewDraft.from_dict(review.draft)
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
    db.commit()
    render_or_send_draft_card(db, draft_id, chat_id, telegram)
    return {"accepted": True, "status": "pending_review"}


def begin_field_edit(db: Session, draft_id: str, field: str, chat_id: str, telegram: TelegramAdapter) -> dict[str, Any]:
    draft = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
    if field == "type":
        draft.pending_field = None
        draft.active_picker_message_id = None
        db.commit()
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
        return show_category_page(db, draft_id, chat_id, None, 0, telegram)
    prompts = {"amount": "Введите новую сумму.", "date": 'Введите новую дату. Можно написать "сегодня" или "2026-03-31".', "comment": "Введите новый комментарий."}
    draft.pending_field = field
    db.commit()
    telegram.send_message(chat_id, prompts.get(field, "Введите новое значение."))
    return {"accepted": True, "status": "awaiting_edit"}


def show_category_page(db: Session, draft_id: str, chat_id: str, message_id: int | None, requested_page: int, telegram: TelegramAdapter) -> dict[str, Any]:
    draft_record = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == draft_id)).scalar_one()
    review_draft = ReviewDraft.from_dict(draft_record.draft)
    categories = load_active_categories(db, review_draft.type)
    page_payload = build_category_picker_page(categories, requested_page)
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

    existing_draft = db.execute(
        select(PendingOperationReview)
        .where(PendingOperationReview.author_id == author.id, PendingOperationReview.status == SourceMessageStatus.PENDING_REVIEW)
        .options(joinedload(PendingOperationReview.source_message).selectinload(SourceMessage.attachments))
        .order_by(PendingOperationReview.updated_at.desc())
    ).scalars().first()
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
                return apply_manual_edit(db, existing_draft.id, existing_draft.pending_field, text_value, chat_id, telegram)
            enqueue_job(
                db,
                job_type=JOB_TYPE_CLARIFICATION_REPARSE,
                payload={"draftId": existing_draft.id, "userText": text_value, "chatId": chat_id},
                household_id=bootstrap_household_id(),
            )
            return {"accepted": True, "status": "clarification_enqueued"}

    telegram_message_id = str(message.get("message_id"))
    source_message = db.execute(select(SourceMessage).where(SourceMessage.telegram_message_id == telegram_message_id)).scalar_one_or_none()
    if source_message:
        source_message.raw_payload = raw_update
        db.commit()
        return {"accepted": True, "status": "duplicate"}

    source_message = SourceMessage(
        household_id=bootstrap_household_id(),
        author_id=author.id,
        telegram_message_id=telegram_message_id,
        telegram_chat_id=chat_id,
        type=SourceMessageType.TELEGRAM_RECEIPT if has_attachment else SourceMessageType.TELEGRAM_TEXT,
        status=SourceMessageStatus.RECEIVED,
        text=text_value or None,
        raw_payload=raw_update,
    )
    db.add(source_message)
    db.commit()
    db.refresh(source_message)
    attachments = persist_attachments(db, message, source_message.id, telegram)
    logger.info("telegram", "message_received", "Telegram message received", {"sourceMessageId": source_message.id, "telegramMessageId": source_message.telegram_message_id, "authorId": author.id, "hasAttachment": has_attachment})
    enqueue_job(
        db,
        job_type=JOB_TYPE_PARSE_SOURCE_MESSAGE,
        payload={"sourceMessageId": source_message.id, "authorId": author.id, "chatId": chat_id, "inputText": text_value, "attachmentIds": [item.id for item in attachments]},
        household_id=bootstrap_household_id(),
    )
    return {"accepted": True, "status": "parse_enqueued"}


def process_parse_source_message(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    source_message = db.execute(select(SourceMessage).where(SourceMessage.id == payload["sourceMessageId"]).options(selectinload(SourceMessage.attachments))).scalar_one()
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
    draft = create_draft_payload(parsed, payload.get("inputText") or source_message.text or "", get_settings_payload(db)["defaultCurrency"], categories)
    review = PendingOperationReview(
        source_message_id=source_message.id,
        author_id=payload.get("authorId"),
        status=SourceMessageStatus.PENDING_REVIEW,
        draft=draft.to_dict(),
    )
    db.add(review)
    source_message.status = SourceMessageStatus.PENDING_REVIEW
    db.commit()
    if get_missing_draft_fields(draft):
        upsert_clarification_session(db, source_message.id, draft)
    render_or_send_draft_card(db, review.id, payload["chatId"], telegram)
    return {"accepted": True, "status": "pending_review", "draftId": review.id}


def reparse_draft_with_clarification(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    review = db.execute(
        select(PendingOperationReview)
        .where(PendingOperationReview.id == payload["draftId"])
        .options(joinedload(PendingOperationReview.source_message).selectinload(SourceMessage.attachments))
    ).scalar_one()
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
    next_draft = merge_draft_with_parsed(current_draft, parsed, payload["userText"], get_settings_payload(db)["defaultCurrency"], categories)
    review.draft = next_draft.to_dict()
    review.pending_field = None
    review.active_picker_message_id = None
    db.commit()
    if get_missing_draft_fields(next_draft):
        upsert_clarification_session(db, review.source_message_id, next_draft)
    else:
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
    account = db.execute(select(TelegramAccount).where(TelegramAccount.telegram_id == author_telegram_id).options(joinedload(TelegramAccount.user))).scalar_one_or_none()
    if not account or not account.user:
        telegram.answer_callback_query(callback["id"], "Пользователь не найден")
        return {"accepted": True, "ignored": True}
    draft = db.execute(
        select(PendingOperationReview)
        .where(PendingOperationReview.author_id == account.user.id, PendingOperationReview.status == SourceMessageStatus.PENDING_REVIEW)
        .order_by(PendingOperationReview.updated_at.desc())
    ).scalars().first()
    if not draft:
        telegram.answer_callback_query(callback["id"], "Активный черновик не найден")
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
        draft.draft = review_draft.to_dict()
        draft.active_picker_message_id = None
        draft.pending_field = None
        db.commit()
        render_or_send_draft_card(db, draft.id, chat_id, telegram)
        return {"accepted": True, "status": "pending_review"}
    if data.startswith(CATEGORY_PAGE_CALLBACK_PREFIX):
        telegram.answer_callback_query(callback["id"])
        page = int(data.replace(CATEGORY_PAGE_CALLBACK_PREFIX, "") or "0")
        return show_category_page(db, draft.id, chat_id, int(message_id), page, telegram)
    telegram.answer_callback_query(callback["id"], "Неизвестное действие")
    return {"accepted": True, "ignored": True}


def notify_transaction_event(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    transaction = db.execute(
        select(Transaction)
        .where(Transaction.id == payload["transactionId"], Transaction.household_id == bootstrap_household_id())
        .options(joinedload(Transaction.author), joinedload(Transaction.category).joinedload(Category.parent))
    ).scalar_one_or_none()
    if not transaction:
        return {"recipients": 0, "delivered": 0, "failed": 0}
    excluded = {item.strip() for item in payload.get("excludeTelegramIds") or [] if str(item).strip()}
    recipients = list(
        db.execute(
            select(TelegramAccount)
            .join(User, TelegramAccount.user_id == User.id)
            .where(TelegramAccount.is_active.is_(True), User.household_id == bootstrap_household_id())
            .order_by(TelegramAccount.created_at.asc())
        ).scalars()
    )
    recipient_ids: list[str] = []
    for item in recipients:
        telegram_id = (item.telegram_id or "").strip()
        if telegram_id and telegram_id not in excluded and telegram_id not in recipient_ids:
            recipient_ids.append(telegram_id)
    if not recipient_ids:
        return {"recipients": 0, "delivered": 0, "failed": 0}
    event = payload.get("event") or "created"
    type_label = "Доход" if transaction.type == TransactionType.INCOME else "Расход"
    category_name = f"{transaction.category.parent.name} / {transaction.category.name}" if transaction.category and transaction.category.parent else (transaction.category.name if transaction.category else "Не указана")
    message = "\n".join([
        "Добавлена новая операция" if event == "created" else "Операция удалена",
        "",
        f"Тип: {type_label}",
        f"Сумма: {float(transaction.amount):.2f} {transaction.currency}",
        f"Дата: {transaction.occurred_at.strftime('%d.%m.%Y')}",
        f"Категория: {category_name}",
        f"Комментарий: {transaction.comment or 'Не указан'}",
        *( [f"Автор: {transaction.author.display_name}"] if transaction.author else [] ),
    ])
    delivered = 0
    failed = 0
    for chat_id in recipient_ids:
        try:
            telegram.send_message(chat_id, message)
            delivered += 1
        except Exception as exc:
            failed += 1
            logger.error("telegram", "transaction_notification_failed", "Transaction notification failed", {"transactionId": transaction.id, "chatId": chat_id, "error": exc})
    return {"recipients": len(recipient_ids), "delivered": delivered, "failed": failed}


def route_telegram_update(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    if payload.get("callback_query"):
        return handle_callback_query(db, payload["callback_query"], telegram)
    if not payload.get("message"):
        return {"accepted": True, "ignored": True}
    return handle_message_update(db, payload["message"], payload, telegram)


def maybe_enqueue_scheduled_backup(db: Session, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    now = datetime.now(timezone(timedelta(hours=3)))
    if not (now.hour == 12 and now.minute == 0 and ((now.day - 1) % 3 == 0)):
        return
    window_start = now.replace(second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    existing_job = db.execute(select(Job).where(Job.job_type == JOB_TYPE_SCHEDULED_BACKUP).order_by(Job.created_at.desc())).scalars().first()
    if existing_job and existing_job.created_at >= window_start:
        return
    enqueue_job(db, job_type=JOB_TYPE_SCHEDULED_BACKUP, payload={"scheduled": True, "schedule": SCHEDULED_BACKUP_SCHEDULE, "timeZone": "Europe/Moscow"}, household_id=bootstrap_household_id())


def process_scheduled_backup(db: Session, telegram: TelegramAdapter) -> dict[str, Any]:
    from app.services_runtime import create_backup

    admin = db.execute(select(User).where(User.role == UserRole.ADMIN).options(selectinload(User.telegram_accounts)).order_by(User.created_at.asc())).scalars().first()
    telegram_id = next((item.telegram_id for item in (admin.telegram_accounts if admin else []) if item.is_active), None)
    if not admin or not telegram_id:
        logger.warn("backup", "scheduled_backup_skipped", "Scheduled Telegram backup skipped: no admin Telegram recipient found")
        return {"status": "skipped"}
    artifact = create_backup({"sub": "system:scheduled-backup", "email": "system@local", "role": "ADMIN"})
    file_path = str(get_settings().backup_path / artifact["fileName"])
    telegram.send_document(
        chat_id=telegram_id,
        file_path=file_path,
        file_name=artifact["fileName"],
        caption="\n".join([
            "Автоматический backup Denga",
            f"Файл: {artifact['fileName']}",
            f"Размер: {artifact['sizeBytes']} bytes",
            f"Создан: {artifact['createdAt']}",
            "Сохраните файл вручную в надежное место.",
        ]),
    )
    return {"status": "sent", "recipientTelegramId": telegram_id, "fileName": artifact["fileName"]}
