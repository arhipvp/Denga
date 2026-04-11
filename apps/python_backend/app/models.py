from __future__ import annotations

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _generate_id() -> str:
    return uuid4().hex


def _utcnow() -> datetime:
    return datetime.utcnow()


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class TransactionType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class CategoryType(str, enum.Enum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"


class TransactionStatus(str, enum.Enum):
    CONFIRMED = "CONFIRMED"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    CANCELLED = "CANCELLED"


class SourceMessageType(str, enum.Enum):
    TELEGRAM_TEXT = "TELEGRAM_TEXT"
    TELEGRAM_RECEIPT = "TELEGRAM_RECEIPT"
    ADMIN_MANUAL = "ADMIN_MANUAL"


class SourceMessageStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    PENDING_REVIEW = "PENDING_REVIEW"
    PARSED = "PARSED"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    CANCELLED = "CANCELLED"
    ERROR = "ERROR"


class ClarificationStatus(str, enum.Enum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


class AiParseAttemptType(str, enum.Enum):
    INITIAL_PARSE = "INITIAL_PARSE"
    CLARIFICATION_REPARSE = "CLARIFICATION_REPARSE"


class Household(Base):
    __tablename__ = "Household"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    default_currency: Mapped[str] = mapped_column("defaultCurrency", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)


class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str] = mapped_column("householdId", ForeignKey("Household.id"))
    email: Mapped[str | None] = mapped_column(String)
    password_hash: Mapped[str | None] = mapped_column("passwordHash", String)
    display_name: Mapped[str] = mapped_column("displayName", String)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="UserRole", create_type=False))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    telegram_accounts: Mapped[list[TelegramAccount]] = relationship("TelegramAccount", back_populates="user")
    review_drafts: Mapped[list[PendingOperationReview]] = relationship("PendingOperationReview", back_populates="author")
    source_messages: Mapped[list[SourceMessage]] = relationship("SourceMessage", back_populates="author")


class TelegramAccount(Base):
    __tablename__ = "TelegramAccount"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    user_id: Mapped[str] = mapped_column("userId", ForeignKey("User.id"))
    telegram_id: Mapped[str] = mapped_column("telegramId", String)
    username: Mapped[str | None] = mapped_column(String)
    first_name: Mapped[str | None] = mapped_column("firstName", String)
    last_name: Mapped[str | None] = mapped_column("lastName", String)
    is_active: Mapped[bool] = mapped_column("isActive", Boolean)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    user: Mapped[User] = relationship("User", back_populates="telegram_accounts")


class Category(Base):
    __tablename__ = "Category"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str] = mapped_column("householdId", ForeignKey("Household.id"))
    parent_id: Mapped[str | None] = mapped_column("parentId", ForeignKey("Category.id"))
    name: Mapped[str] = mapped_column(String)
    type: Mapped[CategoryType] = mapped_column(Enum(CategoryType, name="CategoryType", create_type=False))
    is_active: Mapped[bool] = mapped_column("isActive", Boolean)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    parent: Mapped[Category | None] = relationship("Category", remote_side=[id], backref="children")


class SourceMessage(Base):
    __tablename__ = "SourceMessage"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str] = mapped_column("householdId", ForeignKey("Household.id"))
    author_id: Mapped[str | None] = mapped_column("authorId", ForeignKey("User.id"))
    telegram_message_id: Mapped[str | None] = mapped_column("telegramMessageId", String)
    telegram_chat_id: Mapped[str | None] = mapped_column("telegramChatId", String)
    type: Mapped[SourceMessageType] = mapped_column(Enum(SourceMessageType, name="SourceMessageType", create_type=False))
    status: Mapped[SourceMessageStatus] = mapped_column(Enum(SourceMessageStatus, name="SourceMessageStatus", create_type=False))
    text: Mapped[str | None] = mapped_column(Text)
    raw_payload: Mapped[dict] = mapped_column("rawPayload", JSON)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    attachments: Mapped[list[Attachment]] = relationship("Attachment", back_populates="source_message")
    parse_attempts: Mapped[list[AiParseAttempt]] = relationship("AiParseAttempt", back_populates="source_message")
    clarification_session: Mapped[ClarificationSession | None] = relationship("ClarificationSession", back_populates="source_message", uselist=False)
    review_draft: Mapped[PendingOperationReview | None] = relationship("PendingOperationReview", back_populates="source_message", uselist=False)
    author: Mapped[User | None] = relationship("User", back_populates="source_messages")


class Attachment(Base):
    __tablename__ = "Attachment"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    source_message_id: Mapped[str] = mapped_column("sourceMessageId", ForeignKey("SourceMessage.id"))
    telegram_file_id: Mapped[str | None] = mapped_column("telegramFileId", String)
    telegram_file_path: Mapped[str | None] = mapped_column("telegramFilePath", String)
    mime_type: Mapped[str | None] = mapped_column("mimeType", String)
    original_name: Mapped[str | None] = mapped_column("originalName", String)
    local_path: Mapped[str | None] = mapped_column("localPath", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    source_message: Mapped[SourceMessage] = relationship("SourceMessage", back_populates="attachments")


class AiParseAttempt(Base):
    __tablename__ = "AiParseAttempt"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    source_message_id: Mapped[str] = mapped_column("sourceMessageId", ForeignKey("SourceMessage.id"))
    attempt_type: Mapped[AiParseAttemptType] = mapped_column("attemptType", Enum(AiParseAttemptType, name="AiParseAttemptType", create_type=False))
    provider: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    prompt: Mapped[str] = mapped_column(Text)
    response_payload: Mapped[dict] = mapped_column("responsePayload", JSON)
    success: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)

    source_message: Mapped[SourceMessage] = relationship("SourceMessage", back_populates="parse_attempts")


class ClarificationSession(Base):
    __tablename__ = "ClarificationSession"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    source_message_id: Mapped[str] = mapped_column("sourceMessageId", ForeignKey("SourceMessage.id"))
    status: Mapped[ClarificationStatus] = mapped_column(Enum(ClarificationStatus, name="ClarificationStatus", create_type=False))
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text)
    conversation: Mapped[list[dict] | None] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime(timezone=False))
    resolved_at: Mapped[datetime | None] = mapped_column("resolvedAt", DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    source_message: Mapped[SourceMessage] = relationship("SourceMessage", back_populates="clarification_session")


class PendingOperationReview(Base):
    __tablename__ = "PendingOperationReview"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    source_message_id: Mapped[str] = mapped_column("sourceMessageId", ForeignKey("SourceMessage.id"))
    author_id: Mapped[str | None] = mapped_column("authorId", ForeignKey("User.id"))
    status: Mapped[SourceMessageStatus] = mapped_column(Enum(SourceMessageStatus, name="SourceMessageStatus", create_type=False))
    draft: Mapped[dict] = mapped_column(JSON)
    pending_field: Mapped[str | None] = mapped_column("pendingField", String)
    last_bot_message_id: Mapped[str | None] = mapped_column("lastBotMessageId", String)
    active_picker_message_id: Mapped[str | None] = mapped_column("activePickerMessageId", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    source_message: Mapped[SourceMessage] = relationship("SourceMessage", back_populates="review_draft")
    author: Mapped[User | None] = relationship("User", back_populates="review_drafts")


class Transaction(Base):
    __tablename__ = "Transaction"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str] = mapped_column("householdId", ForeignKey("Household.id"))
    author_id: Mapped[str | None] = mapped_column("authorId", ForeignKey("User.id"))
    category_id: Mapped[str | None] = mapped_column("categoryId", ForeignKey("Category.id"))
    source_message_id: Mapped[str | None] = mapped_column("sourceMessageId", ForeignKey("SourceMessage.id"))
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType, name="TransactionType", create_type=False))
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String)
    occurred_at: Mapped[datetime] = mapped_column("occurredAt", DateTime(timezone=False))
    comment: Mapped[str | None] = mapped_column(Text)
    status: Mapped[TransactionStatus] = mapped_column(Enum(TransactionStatus, name="TransactionStatus", create_type=False))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)

    category: Mapped[Category | None] = relationship("Category")
    author: Mapped[User | None] = relationship("User")
    source_message: Mapped[SourceMessage | None] = relationship("SourceMessage")


class AppSetting(Base):
    __tablename__ = "AppSetting"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str] = mapped_column("householdId", ForeignKey("Household.id"))
    key: Mapped[str] = mapped_column(String)
    value: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)


class Job(Base):
    __tablename__ = "Job"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_generate_id)
    household_id: Mapped[str | None] = mapped_column("householdId", ForeignKey("Household.id"))
    job_type: Mapped[str] = mapped_column("jobType", String)
    status: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column("maxAttempts", Integer, default=3)
    last_error: Mapped[str | None] = mapped_column("lastError", Text)
    dedupe_key: Mapped[str | None] = mapped_column("dedupeKey", String)
    correlation_id: Mapped[str | None] = mapped_column("correlationId", String)
    not_before: Mapped[datetime | None] = mapped_column("notBefore", DateTime(timezone=False))
    locked_at: Mapped[datetime | None] = mapped_column("lockedAt", DateTime(timezone=False))
    locked_by: Mapped[str | None] = mapped_column("lockedBy", String)
    lease_expires_at: Mapped[datetime | None] = mapped_column("leaseExpiresAt", DateTime(timezone=False))
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=False), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", DateTime(timezone=False), default=_utcnow, onupdate=_utcnow)
