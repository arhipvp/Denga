from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.models import CategoryType


ReviewType = Literal["income", "expense"] | None


@dataclass(slots=True)
class ActiveCategory:
    id: str
    name: str
    type: CategoryType
    parent_id: str
    parent_name: str
    display_path: str


@dataclass(slots=True)
class ReviewDraft:
    type: ReviewType
    amount: float | None
    occurred_at: str | None
    category_id: str | None
    category_name: str | None
    comment: str | None
    currency: str | None
    confidence: float
    ambiguities: list[str]
    follow_up_question: str | None
    source_text: str | None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReviewDraft":
        return cls(
            type=data.get("type"),
            amount=float(data["amount"]) if data.get("amount") is not None else None,
            occurred_at=data.get("occurredAt"),
            category_id=data.get("categoryId"),
            category_name=data.get("categoryName"),
            comment=data.get("comment"),
            currency=data.get("currency"),
            confidence=float(data.get("confidence") or 0),
            ambiguities=[str(item) for item in data.get("ambiguities") or []],
            follow_up_question=data.get("followUpQuestion"),
            source_text=data.get("sourceText"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "amount": self.amount,
            "occurredAt": self.occurred_at,
            "categoryId": self.category_id,
            "categoryName": self.category_name,
            "comment": self.comment,
            "currency": self.currency,
            "confidence": self.confidence,
            "ambiguities": self.ambiguities,
            "followUpQuestion": self.follow_up_question,
            "sourceText": self.source_text,
        }


@dataclass(slots=True)
class ParsedTransaction:
    type: ReviewType
    amount: float | None
    occurred_at: str | None
    category_candidate: str | None
    comment: str | None
    confidence: float
    ambiguities: list[str]
    follow_up_question: str | None
    resolved_currency: str | None


def extract_message_text(message: dict[str, Any]) -> str:
    return str(message.get("text") or message.get("caption") or "").strip()
