from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.services_core import get_settings_payload


class SettingsRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_payload(self, settings: Settings | None = None) -> dict[str, Any]:
        return get_settings_payload(self._db, settings)
