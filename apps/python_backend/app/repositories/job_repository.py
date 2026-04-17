from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, or_, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.domain.job_policy import ACTIVE_JOB_STATUSES, JobStatus, build_job_dedupe_key, compute_retry_not_before
from app.models import Job


class JobRepository:
    def __init__(self, db: Session) -> None:
        self._db = db

    def _claimable_jobs_query(self, now: datetime, *, use_skip_locked: bool) -> Select[tuple[Job]]:
        query: Select[tuple[Job]] = (
            select(Job)
            .where(
                Job.attempts < Job.max_attempts,
                or_(Job.not_before.is_(None), Job.not_before <= now),
                or_(
                    Job.status == JobStatus.PENDING.value,
                    (
                        (Job.status == JobStatus.RUNNING.value)
                        & Job.lease_expires_at.is_not(None)
                        & (Job.lease_expires_at <= now)
                    ),
                ),
            )
            .order_by(Job.created_at.asc())
            .limit(1)
        )
        if use_skip_locked:
            query = query.with_for_update(skip_locked=True)
        return query

    def enqueue(
        self,
        *,
        job_type: str,
        payload: dict[str, Any],
        household_id: str | None,
        not_before: datetime | None = None,
        max_attempts: int = 3,
        dedupe_key: str | None = None,
        correlation_id: str | None = None,
    ) -> Job:
        settings = get_settings()
        dedupe_key = dedupe_key or (build_job_dedupe_key(job_type, payload) if settings.feature_job_dedupe_enabled else None)
        if settings.feature_job_dedupe_enabled and dedupe_key:
            existing = self._db.execute(
                select(Job).where(
                    Job.job_type == job_type,
                    Job.dedupe_key == dedupe_key,
                    Job.status.in_(ACTIVE_JOB_STATUSES),
                )
            ).scalar_one_or_none()
            if existing:
                return existing
        job = Job(
            household_id=household_id,
            job_type=job_type,
            status=JobStatus.PENDING.value,
            payload=payload,
            attempts=0,
            max_attempts=max_attempts,
            not_before=not_before,
            dedupe_key=dedupe_key,
            correlation_id=correlation_id,
        )
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        return job

    def claim_next(self) -> Job | None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        lease_timeout = timedelta(seconds=get_settings().job_lease_seconds)
        try:
            job = self._db.execute(self._claimable_jobs_query(now, use_skip_locked=True)).scalars().first()
        except OperationalError:
            self._db.rollback()
            job = self._db.execute(self._claimable_jobs_query(now, use_skip_locked=False)).scalars().first()
        if not job:
            self._db.rollback()
            return None
        job.status = JobStatus.RUNNING.value
        job.locked_at = now
        job.locked_by = get_settings().worker_id
        job.lease_expires_at = now + lease_timeout
        self._db.commit()
        self._db.refresh(job)
        return job

    def mark_completed(self, job: Job) -> None:
        job.status = JobStatus.COMPLETED.value
        job.locked_at = None
        job.locked_by = None
        job.lease_expires_at = None
        self._db.commit()

    def mark_failed(self, job: Job, error: Exception) -> None:
        settings = get_settings()
        job.attempts += 1
        job.last_error = str(error)
        job.locked_at = None
        job.locked_by = None
        job.lease_expires_at = None
        if job.attempts >= job.max_attempts:
            job.status = JobStatus.DEAD_LETTER.value if settings.feature_dead_letter_jobs_enabled else JobStatus.FAILED.value
        else:
            job.status = JobStatus.PENDING.value
            job.not_before = compute_retry_not_before(job.attempts)
        self._db.commit()

    def queue_metrics(self) -> dict[str, Any]:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        pending_jobs = list(
            self._db.execute(select(Job).where(Job.status == JobStatus.PENDING.value).order_by(Job.created_at.asc())).scalars()
        )
        running_jobs = list(self._db.execute(select(Job).where(Job.status == JobStatus.RUNNING.value)).scalars())
        dead_jobs = list(self._db.execute(select(Job).where(Job.status == JobStatus.DEAD_LETTER.value)).scalars())
        oldest_pending = pending_jobs[0].created_at if pending_jobs else None
        return {
            "pendingCount": len(pending_jobs),
            "runningCount": len(running_jobs),
            "deadLetterCount": len(dead_jobs),
            "oldestPendingLagSeconds": max((now - oldest_pending).total_seconds(), 0) if oldest_pending else 0,
        }
