from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.telegram_types import ParsedTransaction


class AiAdapter:
    def __init__(self) -> None:
        self.settings = get_settings()

    def build_prompt_snapshot(self, request: dict[str, Any]) -> dict[str, Any]:
        return {
            "systemPrompt": self._build_runtime_system_prompt(request),
            "userMessage": self._build_user_message(request),
            "categories": list(request["categories"]),
        }

    def parse_transaction(self, request: dict[str, Any]) -> ParsedTransaction:
        if not self.settings.polza_api_key:
            raise RuntimeError("POLZA_API_KEY is not configured")

        payload = {
            "model": request["model"],
            "messages": self._build_messages(request),
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "transaction_parse",
                    "schema": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "type": {"type": ["string", "null"], "enum": ["income", "expense", None]},
                            "amount": {"type": ["number", "null"]},
                            "occurredAt": {"type": ["string", "null"]},
                            "categoryCandidate": {"type": ["string", "null"]},
                            "comment": {"type": ["string", "null"]},
                            "confidence": {"type": "number"},
                            "ambiguities": {"type": "array", "items": {"type": "string"}},
                            "followUpQuestion": {"type": ["string", "null"]},
                            "resolvedCurrency": {"type": ["string", "null"]},
                        },
                        "required": [
                            "type", "amount", "occurredAt", "categoryCandidate", "comment", "confidence", "ambiguities", "followUpQuestion", "resolvedCurrency"
                        ],
                    },
                },
            },
        }

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.settings.polza_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.polza_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or "{}"
        import json
        parsed = json.loads(content)
        return ParsedTransaction(
            type=parsed.get("type"),
            amount=parsed.get("amount"),
            occurred_at=parsed.get("occurredAt"),
            category_candidate=parsed.get("categoryCandidate"),
            comment=parsed.get("comment"),
            confidence=float(parsed.get("confidence") or 0),
            ambiguities=[str(item) for item in parsed.get("ambiguities") or []],
            follow_up_question=parsed.get("followUpQuestion"),
            resolved_currency=parsed.get("resolvedCurrency"),
        )

    def _build_messages(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        system_prompt = self._build_runtime_system_prompt(request)
        user_message = self._build_user_message(request)
        if request.get("imageDataUrl"):
            return [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [{"type": "text", "text": user_message}, {"type": "image_url", "image_url": {"url": request["imageDataUrl"], "detail": "auto"}}]},
            ]
        return [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]

    def _build_runtime_system_prompt(self, request: dict[str, Any]) -> str:
        return "\n".join(
            [
                request["systemPrompt"].strip(),
                "",
                f"Текущая дата: {request['currentDate']}.",
                f"Базовая валюта household: {request['householdCurrency']}.",
                f"Доступные категории: {', '.join(request['categories']) or 'нет категорий'}.",
                "Правила: categoryCandidate должен быть только одним точным значением из списка доступных категорий или null.",
                "Нельзя придумывать новые категории, merchant names, синонимы или значения вне списка.",
                "Если дата не указана явно, верни текущую дату из поля currentDate.",
            ]
        )

    def _build_user_message(self, request: dict[str, Any]) -> str:
        history = (
            "\n".join(f"{index + 1}. {item['role']}: {item['text']}" for index, item in enumerate(request.get("conversationContext") or []))
            or "Нет истории уточнения."
        )
        return "\n".join(
            item
            for item in (
                f"Контекст clarification:\n{request['clarificationPrompt']}" if request.get("clarificationPrompt") else None,
                "",
                f"История диалога:\n{history}",
                "",
                f"Текущее сообщение пользователя:\n{request['userInput']}",
            )
            if item is not None
        )
