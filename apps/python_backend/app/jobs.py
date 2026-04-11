from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.domain.job_policy import JobStatus
from app.models import Job
from app.repositories.job_repository import JobRepository


JOB_STATUS_PENDING = JobStatus.PENDING.value
JOB_STATUS_RUNNING = JobStatus.RUNNING.value
JOB_STATUS_COMPLETED = JobStatus.COMPLETED.value
JOB_STATUS_FAILED = JobStatus.FAILED.value
JOB_STATUS_DEAD_LETTER = JobStatus.DEAD_LETTER.value


def enqueue_job(
    db: Session,
    *,
    job_type: str,
    payload: dict,
    household_id: str | None,
    not_before: datetime | None = None,
    max_attempts: int = 3,
    dedupe_key: str | None = None,
    correlation_id: str | None = None,
) -> Job:
    return JobRepository(db).enqueue(
        job_type=job_type,
        payload=payload,
        household_id=household_id,
        not_before=not_before,
        max_attempts=max_attempts,
        dedupe_key=dedupe_key,
        correlation_id=correlation_id,
    )


def claim_next_job(db: Session) -> Job | None:
    return JobRepository(db).claim_next()


def mark_job_completed(db: Session, job: Job) -> None:
    JobRepository(db).mark_completed(job)


def mark_job_failed(db: Session, job: Job, error: Exception) -> None:
    JobRepository(db).mark_failed(job, error)
