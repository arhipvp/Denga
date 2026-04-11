from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.observability import get_log_context
from app.repositories.job_repository import JobRepository


def enqueue_use_case_job(
    db: Session,
    *,
    job_type: str,
    payload: dict[str, Any],
    household_id: str | None,
    not_before=None,
    max_attempts: int = 3,
    dedupe_key: str | None = None,
):
    return JobRepository(db).enqueue(
        job_type=job_type,
        payload=payload,
        household_id=household_id,
        not_before=not_before,
        max_attempts=max_attempts,
        dedupe_key=dedupe_key,
        correlation_id=get_log_context().get("correlation_id"),
    )
