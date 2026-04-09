from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Job


JOB_STATUS_PENDING = "pending"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_FAILED = "failed"


def enqueue_job(
    db: Session,
    *,
    job_type: str,
    payload: dict,
    household_id: str | None,
    not_before: datetime | None = None,
    max_attempts: int = 3,
) -> Job:
    job = Job(
        household_id=household_id,
        job_type=job_type,
        status=JOB_STATUS_PENDING,
        payload=payload,
        attempts=0,
        max_attempts=max_attempts,
        not_before=not_before,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next_job(db: Session) -> Job | None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    job = db.execute(
        select(Job)
        .where(
            Job.status == JOB_STATUS_PENDING,
            Job.attempts < Job.max_attempts,
            or_(Job.not_before.is_(None), Job.not_before <= now),
        )
        .order_by(Job.created_at.asc())
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()

    if not job:
        db.rollback()
        return None

    settings = get_settings()
    job.status = JOB_STATUS_RUNNING
    job.locked_at = now
    job.locked_by = settings.worker_id
    db.commit()
    db.refresh(job)
    return job


def mark_job_completed(db: Session, job: Job) -> None:
    job.status = JOB_STATUS_COMPLETED
    job.locked_at = None
    job.locked_by = None
    db.commit()


def mark_job_failed(db: Session, job: Job, error: Exception) -> None:
    job.attempts += 1
    job.last_error = str(error)
    job.locked_at = None
    job.locked_by = None
    job.status = JOB_STATUS_FAILED if job.attempts >= job.max_attempts else JOB_STATUS_PENDING
    db.commit()
