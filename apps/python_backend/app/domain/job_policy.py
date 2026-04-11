from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from typing import Any


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD_LETTER = "dead_letter"


ACTIVE_JOB_STATUSES = (JobStatus.PENDING.value, JobStatus.RUNNING.value)

DEFAULT_RETRY_BASE_SECONDS = 15


def compute_retry_not_before(attempts: int, *, base_seconds: int = DEFAULT_RETRY_BASE_SECONDS) -> datetime:
    delay_seconds = max(base_seconds, base_seconds * (2 ** max(attempts - 1, 0)))
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=delay_seconds)


def build_job_dedupe_key(job_type: str, payload: dict[str, Any]) -> str | None:
    if job_type == "telegram_update":
        update_id = payload.get("update_id")
        return f"telegram-update:{update_id}" if update_id is not None else None
    if job_type == "parse_source_message":
        source_message_id = payload.get("sourceMessageId")
        return f"parse-source:{source_message_id}" if source_message_id else None
    if job_type == "clarification_reparse":
        draft_id = payload.get("draftId")
        user_text = str(payload.get("userText") or "").strip()
        if not draft_id:
            return None
        if not user_text:
            return f"clarification:{draft_id}"
        digest = hashlib.sha256(user_text.encode("utf-8")).hexdigest()[:16]
        return f"clarification:{draft_id}:{digest}"
    if job_type == "send_transaction_notifications":
        transaction_id = payload.get("transactionId")
        event = payload.get("event")
        return f"notify:{transaction_id}:{event}" if transaction_id and event else None
    if job_type == "scheduled_backup":
        schedule = payload.get("schedule")
        slot = payload.get("slot") or payload.get("scheduledFor")
        return f"scheduled-backup:{schedule}:{slot}" if schedule and slot else None
    return None
