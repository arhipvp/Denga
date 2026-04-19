from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.logging_utils import logger
from app.telegram_helpers import create_main_menu_reply_markup


class TelegramAdapter:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def get_status(self) -> dict[str, Any]:
        return {
            "mode": self.settings.telegram_mode,
            "botConfigured": bool(self.settings.telegram_bot_token),
            "webhookUrl": self.settings.telegram_webhook_url,
        }

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None = None) -> dict[str, Any]:
        if not self.settings.telegram_bot_token:
            return {"message_id": 0}
        resolved_reply_markup = reply_markup or create_main_menu_reply_markup()
        keyboard_rows = resolved_reply_markup.get("keyboard") if isinstance(resolved_reply_markup, dict) else None
        inline_rows = resolved_reply_markup.get("inline_keyboard") if isinstance(resolved_reply_markup, dict) else None
        logger.info(
            "telegram",
            "send_message",
            "Telegram sendMessage requested",
            {
                "chatId": chat_id,
                "textPreview": text[:120],
                "keyboardRows": [
                    [str(button.get("text") or "") for button in row if isinstance(button, dict)]
                    for row in (keyboard_rows or [])
                    if isinstance(row, list)
                ],
                "inlineKeyboardRows": [
                    [str(button.get("text") or "") for button in row if isinstance(button, dict)]
                    for row in (inline_rows or [])
                    if isinstance(row, list)
                ],
            },
        )
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": resolved_reply_markup,
        }
        return self._request("sendMessage", method="POST", json=payload).get("result", {"message_id": 0})

    def send_document(self, *, chat_id: str, file_path: str, file_name: str, caption: str | None = None) -> dict[str, Any]:
        if not self.settings.telegram_bot_token:
            return {"message_id": 0}
        with Path(file_path).open("rb") as handle:
            files = {"document": (file_name, handle, "application/octet-stream")}
            data = {"chat_id": chat_id}
            if caption:
                data["caption"] = caption
            return self._request("sendDocument", method="POST", data=data, files=files).get("result", {"message_id": 0})

    def send_photo(self, *, chat_id: str, file_name: str, photo: bytes, caption: str | None = None) -> dict[str, Any]:
        if not self.settings.telegram_bot_token:
            return {"message_id": 0}
        files = {"photo": (file_name, photo, "image/png")}
        data = {"chat_id": chat_id}
        if caption:
            data["caption"] = caption
            data["parse_mode"] = "HTML"
        return self._request("sendPhoto", method="POST", data=data, files=files).get("result", {"message_id": 0})

    def edit_message(self, chat_id: str, message_id: int, text: str, reply_markup: dict | None = None) -> bool:
        if not self.settings.telegram_bot_token:
            return False
        payload: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": "HTML"}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        try:
            self._request(
                "editMessageText",
                method="POST",
                json=payload,
            )
            return True
        except httpx.HTTPStatusError as exc:
            logger.warn(
                "telegram",
                "edit_message_failed",
                "Telegram editMessageText failed",
                self._build_http_error_context(chat_id, message_id, "editMessageText", exc),
            )
            return False
        except httpx.HTTPError as exc:
            logger.warn(
                "telegram",
                "edit_message_failed",
                "Telegram editMessageText failed",
                {"chatId": chat_id, "messageId": message_id, "telegramMethod": "editMessageText", "error": exc},
            )
            return False

    def delete_message(self, chat_id: str, message_id: int) -> bool:
        if not self.settings.telegram_bot_token:
            return False
        try:
            self._request("deleteMessage", method="POST", json={"chat_id": chat_id, "message_id": message_id})
            return True
        except httpx.HTTPError:
            return False

    def clear_inline_keyboard(self, chat_id: str, message_id: int) -> bool:
        if not self.settings.telegram_bot_token:
            return False
        try:
            self._request(
                "editMessageReplyMarkup",
                method="POST",
                json={"chat_id": chat_id, "message_id": message_id, "reply_markup": {"inline_keyboard": []}},
            )
            return True
        except httpx.HTTPError:
            return False

    def answer_callback_query(self, callback_query_id: str, text: str | None = None) -> None:
        if not self.settings.telegram_bot_token:
            return
        payload: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text:
            payload["text"] = text
        self._request("answerCallbackQuery", method="POST", json=payload)

    def get_file_metadata(self, file_id: str) -> dict[str, Any]:
        return self._request("getFile", method="GET", params={"file_id": file_id}).get("result", {})

    def get_updates(self, *, offset: int | None = None, timeout: int = 20) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"timeout": timeout}
        if offset is not None:
            params["offset"] = offset
        return self._request("getUpdates", method="GET", params=params).get("result", [])

    def download_file_bytes(self, file_path: str) -> bytes:
        if not self.settings.telegram_bot_token:
            return b""
        with httpx.Client(timeout=30.0) as client:
            response = client.get(f"https://api.telegram.org/file/bot{self.settings.telegram_bot_token}/{file_path}")
            response.raise_for_status()
            return response.content

    def build_attachment_data_url(self, file_id: str | None, file_path: str | None, mime_type: str | None) -> str | None:
        if not self.settings.telegram_bot_token or not file_id:
            return None
        resolved_path = file_path or self.get_file_metadata(file_id).get("file_path")
        if not resolved_path:
            return None
        payload = base64.b64encode(self.download_file_bytes(resolved_path)).decode("ascii")
        resolved_mime_type = mime_type or self._detect_mime_type(resolved_path)
        return f"data:{resolved_mime_type};base64,{payload}"

    def _request(self, method_name: str, *, method: str, **kwargs: Any) -> dict[str, Any]:
        if not self.settings.telegram_bot_token:
            return {"ok": False, "result": {}}
        url = f"https://api.telegram.org/bot{self.settings.telegram_bot_token}/{method_name}"
        with httpx.Client(timeout=30.0) as client:
            response = client.request(method, url, **kwargs)
            response.raise_for_status()
            return response.json()

    def _detect_mime_type(self, file_path: str) -> str:
        normalized = file_path.lower()
        if normalized.endswith(".png"):
            return "image/png"
        if normalized.endswith(".webp"):
            return "image/webp"
        if normalized.endswith(".pdf"):
            return "application/pdf"
        return "image/jpeg"

    def _build_http_error_context(self, chat_id: str, message_id: int, method_name: str, exc: httpx.HTTPStatusError) -> dict[str, Any]:
        response_body = ""
        try:
            response_body = exc.response.text
        except Exception:
            response_body = ""
        return {
            "chatId": chat_id,
            "messageId": message_id,
            "telegramMethod": method_name,
            "statusCode": exc.response.status_code,
            "responseBody": response_body[:500],
            "errorType": exc.__class__.__name__,
        }
