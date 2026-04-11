from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.ai_adapter import AiAdapter
from app.domain.draft_state import DraftLifecycleState
from app.logging_utils import logger
from app.models import AiParseAttemptType, SourceMessage
from app.observability import increment_metric
from app.repositories.category_repository import CategoryRepository
from app.repositories.draft_repository import DraftRepository
from app.repositories.settings_repository import SettingsRepository
from app.repositories.source_message_repository import SourceMessageRepository
from app.telegram_adapter import TelegramAdapter
from app.telegram_helpers import apply_heuristics, create_draft_payload, get_missing_draft_fields, merge_draft_with_parsed, render_draft_text
from app.telegram_types import ParsedTransaction, ReviewDraft
from app.use_cases.draft_review import render_or_send_draft_card, resolve_clarification_session, upsert_clarification_session


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
    settings = SettingsRepository(db).get_payload()
    categories = CategoryRepository(db).list_active()
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
        logger.warn("ai", "parse_fallback", "AI parsing failed, fallback heuristics applied", {"sourceMessageId": source_message.id, "error": str(exc)})
        return fallback


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
    categories = CategoryRepository(db).list_active(parsed.type)
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
    categories = CategoryRepository(db).list_active(parsed.type)
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
