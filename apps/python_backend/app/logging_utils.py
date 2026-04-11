import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.observability import get_log_context


@dataclass(slots=True)
class LogRecord:
    timestamp: str
    level: str
    source: str
    event: str
    message: str
    context: dict[str, Any] | None = None
    request_id: str | None = None
    correlation_id: str | None = None


class AppLogger:
    def __init__(self) -> None:
        settings = get_settings()
        self._log_dir = settings.log_path
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._log_file = self._log_dir / "app.log"

    def debug(self, source: str, event: str, message: str, context: dict[str, Any] | None = None) -> None:
        self._write("debug", source, event, message, context)

    def info(self, source: str, event: str, message: str, context: dict[str, Any] | None = None) -> None:
        self._write("info", source, event, message, context)

    def warn(self, source: str, event: str, message: str, context: dict[str, Any] | None = None) -> None:
        self._write("warn", source, event, message, context)

    def error(self, source: str, event: str, message: str, context: dict[str, Any] | None = None) -> None:
        self._write("error", source, event, message, context)

    def read_log_file(self) -> Path:
        return self._log_file

    def _write(
        self,
        level: str,
        source: str,
        event: str,
        message: str,
        context: dict[str, Any] | None,
    ) -> None:
        record = LogRecord(
            timestamp=datetime.now(timezone.utc).isoformat(),
            level=level,
            source=source,
            event=event,
            message=message,
            context=self._sanitize({**get_log_context(), **(context or {})}),
            request_id=get_log_context().get("request_id"),
            correlation_id=get_log_context().get("correlation_id"),
        )
        line = json.dumps(asdict(record), ensure_ascii=False)
        print(line)
        with self._log_file.open("a", encoding="utf-8") as handle:
            handle.write(f"{line}\n")

    def _sanitize(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, list):
            return [self._sanitize(item) for item in value]
        if isinstance(value, dict):
            sanitized: dict[str, Any] = {}
            for key, item in value.items():
                normalized = key.lower()
                if (
                    "password" in normalized
                    or "token" in normalized
                    or "secret" in normalized
                    or normalized.endswith("authorization")
                    or normalized == "authorization"
                ):
                    sanitized[key] = "[REDACTED]"
                else:
                    sanitized[key] = self._sanitize(item)
            return sanitized
        if isinstance(value, Exception):
            return {
                "name": value.__class__.__name__,
                "message": str(value),
            }
        return value


logger = AppLogger()
