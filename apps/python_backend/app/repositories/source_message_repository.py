from __future__ import annotations

import json
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    AiParseAttempt,
    AiParseAttemptType,
    Attachment,
    SourceMessage,
    SourceMessageStatus,
    SourceMessageType,
    TelegramAccount,
    User,
    UserRole,
)
from app.services_core import bootstrap_household_id


class SourceMessageRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_by_id(self, source_message_id: str) -> SourceMessage | None:
        return (
            self._db.execute(
                select(SourceMessage)
                .where(SourceMessage.id == source_message_id)
                .options(
                    selectinload(SourceMessage.attachments),
                    selectinload(SourceMessage.parse_attempts),
                    joinedload(SourceMessage.review_draft),
                    joinedload(SourceMessage.clarification_session),
                )
            )
            .scalars()
            .first()
        )

    def get_by_telegram_message_id(self, telegram_message_id: str) -> SourceMessage | None:
        return (
            self._db.execute(select(SourceMessage).where(SourceMessage.telegram_message_id == telegram_message_id))
            .scalars()
            .first()
        )

    def upsert_telegram_user(self, message: dict[str, Any]) -> User:
        from_data = message.get("from") or {}
        telegram_id = str(from_data.get("id") or f"chat-{message.get('chat', {}).get('id')}")
        account = (
            self._db.execute(
                select(TelegramAccount)
                .where(TelegramAccount.telegram_id == telegram_id)
                .options(joinedload(TelegramAccount.user))
            )
            .scalars()
            .first()
        )
        if account and account.user:
            account.username = from_data.get("username")
            account.first_name = from_data.get("first_name")
            account.last_name = from_data.get("last_name")
            account.is_active = True
            self._db.commit()
            self._db.refresh(account.user)
            return account.user
        user = User(
            household_id=bootstrap_household_id(),
            display_name=" ".join(item for item in (from_data.get("first_name"), from_data.get("last_name")) if item)
            or from_data.get("username")
            or f"Telegram {telegram_id}",
            role=UserRole.MEMBER,
        )
        self._db.add(user)
        self._db.flush()
        account = TelegramAccount(
            user_id=user.id,
            telegram_id=telegram_id,
            username=from_data.get("username"),
            first_name=from_data.get("first_name"),
            last_name=from_data.get("last_name"),
            is_active=True,
        )
        self._db.add(account)
        self._db.commit()
        self._db.refresh(user)
        return user

    def create_received(
        self,
        *,
        author_id: str | None,
        telegram_message_id: str,
        telegram_chat_id: str,
        type_: SourceMessageType,
        text: str | None,
        raw_payload: dict[str, Any],
    ) -> SourceMessage:
        source_message = SourceMessage(
            household_id=bootstrap_household_id(),
            author_id=author_id,
            telegram_message_id=telegram_message_id,
            telegram_chat_id=telegram_chat_id,
            type=type_,
            status=SourceMessageStatus.RECEIVED,
            text=text,
            raw_payload=raw_payload,
        )
        self._db.add(source_message)
        self._db.commit()
        self._db.refresh(source_message)
        return source_message

    def persist_attachments(
        self,
        *,
        message: dict[str, Any],
        source_message_id: str,
        get_file_metadata: Callable[[str], dict[str, Any]],
    ) -> list[Attachment]:
        document = message.get("document") or {}
        photos = message.get("photo") or []
        file_id = document.get("file_id") or (photos[-1].get("file_id") if photos else None)
        if not file_id:
            return []
        file_meta = get_file_metadata(file_id)
        attachment = Attachment(
            source_message_id=source_message_id,
            telegram_file_id=file_id,
            telegram_file_path=file_meta.get("file_path"),
            mime_type=document.get("mime_type"),
            original_name=document.get("file_name"),
            local_path=None,
        )
        self._db.add(attachment)
        self._db.commit()
        self._db.refresh(attachment)
        return [attachment]

    def record_parse_attempt(
        self,
        *,
        source_message_id: str,
        attempt_type: AiParseAttemptType,
        model: str,
        prompt: dict[str, Any],
        response_payload: dict[str, Any],
        success: bool = True,
    ) -> None:
        self._db.add(
            AiParseAttempt(
                source_message_id=source_message_id,
                attempt_type=attempt_type,
                provider="polza.ai",
                model=model,
                prompt=json.dumps(prompt, ensure_ascii=False),
                response_payload=response_payload,
                success=success,
            )
        )
        self._db.commit()
