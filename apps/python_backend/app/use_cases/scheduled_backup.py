from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings, get_settings
from app.domain.job_policy import build_job_dedupe_key
from app.logging_utils import logger
from app.models import User, UserRole
from app.observability import set_gauge
from app.services_core import bootstrap_household_id
from app.telegram_adapter import TelegramAdapter
from app.use_cases.jobs import enqueue_use_case_job


JOB_TYPE_SCHEDULED_BACKUP = "scheduled_backup"
SCHEDULED_BACKUP_SCHEDULE = "0 0 12 */3 * *"


def maybe_enqueue_scheduled_backup(db: Session, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    now = datetime.now(timezone(timedelta(hours=3)))
    if not (now.hour == 12 and now.minute == 0 and ((now.day - 1) % 3 == 0)):
        return
    window_start = now.replace(second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    payload = {
        "scheduled": True,
        "schedule": SCHEDULED_BACKUP_SCHEDULE,
        "timeZone": "Europe/Moscow",
        "slot": window_start.isoformat(),
        "scheduledFor": window_start.isoformat(),
    }
    enqueue_use_case_job(
        db,
        job_type=JOB_TYPE_SCHEDULED_BACKUP,
        payload=payload,
        household_id=bootstrap_household_id(),
        dedupe_key=build_job_dedupe_key(JOB_TYPE_SCHEDULED_BACKUP, payload),
    )


def process_scheduled_backup(db: Session, telegram: TelegramAdapter) -> dict[str, Any]:
    from app.services_runtime import create_backup

    admin = (
        db.execute(
            select(User)
            .where(User.role == UserRole.ADMIN)
            .options(selectinload(User.telegram_accounts))
            .order_by(User.created_at.asc())
        )
        .scalars()
        .first()
    )
    telegram_id = next((item.telegram_id for item in (admin.telegram_accounts if admin else []) if item.is_active), None)
    if not admin or not telegram_id:
        logger.warn(
            "backup",
            "scheduled_backup_skipped",
            "Scheduled Telegram backup skipped: no admin Telegram recipient found",
        )
        return {"status": "skipped"}
    artifact = create_backup({"sub": "system:scheduled-backup", "email": "system@local", "role": "ADMIN"})
    set_gauge("backup.last_created_at_epoch", datetime.now(timezone.utc).timestamp())
    file_path = str(get_settings().backup_path / artifact["fileName"])
    telegram.send_document(
        chat_id=telegram_id,
        file_path=file_path,
        file_name=artifact["fileName"],
        caption="\n".join(
            [
                "Автоматический backup Denga",
                f"Файл: {artifact['fileName']}",
                f"Размер: {artifact['sizeBytes']} bytes",
                f"Создан: {artifact['createdAt']}",
                "Сохраните файл вручную в надежное место.",
            ]
        ),
    )
    return {"status": "sent", "recipientTelegramId": telegram_id, "fileName": artifact["fileName"]}
