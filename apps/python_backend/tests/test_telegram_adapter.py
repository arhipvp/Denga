from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings
from app.telegram_adapter import TelegramAdapter


def _settings() -> Settings:
    return Settings(
        app_env="test",
        database_url="postgresql://user:pass@localhost:5432/denga",
        jwt_secret="secret",
        polza_api_key="key",
        telegram_bot_token="123456:secret-token",
    )


def test_edit_message_omits_reply_markup_when_not_provided(monkeypatch) -> None:
    adapter = TelegramAdapter(_settings())
    captured: dict[str, Any] = {}

    def fake_request(method_name: str, *, method: str, **kwargs: Any) -> dict[str, Any]:
        captured["method_name"] = method_name
        captured["method"] = method
        captured["kwargs"] = kwargs
        return {"ok": True, "result": True}

    monkeypatch.setattr(adapter, "_request", fake_request)

    result = adapter.edit_message("42", 347, "✅ Операция сохранена")

    assert result is True
    assert captured["method_name"] == "editMessageText"
    assert captured["method"] == "POST"
    assert "reply_markup" not in captured["kwargs"]["json"]


def test_edit_message_includes_reply_markup_when_provided(monkeypatch) -> None:
    adapter = TelegramAdapter(_settings())
    captured: dict[str, Any] = {}
    keyboard = {"inline_keyboard": [[{"text": "OK", "callback_data": "ok"}]]}

    def fake_request(method_name: str, *, method: str, **kwargs: Any) -> dict[str, Any]:
        captured["json"] = kwargs["json"]
        return {"ok": True, "result": True}

    monkeypatch.setattr(adapter, "_request", fake_request)

    result = adapter.edit_message("42", 347, "text", keyboard)

    assert result is True
    assert captured["json"]["reply_markup"] == keyboard


def test_build_http_error_context_does_not_include_token_in_payload() -> None:
    adapter = TelegramAdapter(_settings())
    request = httpx.Request("POST", "https://api.telegram.org/bot123456:secret-token/editMessageText")
    response = httpx.Response(400, request=request, text='{"ok":false,"description":"Bad Request"}')
    error = httpx.HTTPStatusError("bad request", request=request, response=response)

    context = adapter._build_http_error_context("42", 347, "editMessageText", error)

    assert context["telegramMethod"] == "editMessageText"
    assert context["statusCode"] == 400
    assert "secret-token" not in context["responseBody"]
    assert "token" not in "".join(context.keys()).lower()
