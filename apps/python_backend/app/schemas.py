from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=1)


class CategoryWriteRequest(BaseModel):
    name: str = Field(min_length=1)
    type: Literal["income", "expense"]
    isActive: bool | None = None
    parentId: str | None = None


class CategoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    type: Literal["income", "expense"] | None = None
    isActive: bool | None = None
    parentId: str | None = None


class TransactionCreateRequest(BaseModel):
    type: Literal["income", "expense"]
    amount: float = Field(gt=0)
    occurredAt: datetime
    categoryId: str = Field(min_length=1)
    comment: str | None = None


class TransactionUpdateRequest(BaseModel):
    type: Literal["income", "expense"] | None = None
    amount: float | None = Field(default=None, gt=0)
    occurredAt: datetime | None = None
    categoryId: str | None = Field(default=None, min_length=1)
    comment: str | None = None
    status: Literal["confirmed", "needs_clarification", "cancelled"] | None = None


class UserRenameRequest(BaseModel):
    displayName: str = Field(min_length=1, max_length=120)

    @field_validator("displayName")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class SettingsUpdateRequest(BaseModel):
    householdName: str = Field(min_length=1)
    defaultCurrency: str = Field(min_length=3, max_length=3)
    telegramMode: Literal["polling", "webhook"]
    clarificationTimeoutMinutes: int = Field(gt=0)
    parsingPrompt: str = Field(min_length=10)
    aiModel: str = Field(min_length=3)
    clarificationPrompt: str = Field(min_length=10)


class TelegramWebhookRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class PagedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    pageSize: int
