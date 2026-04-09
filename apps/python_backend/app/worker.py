from __future__ import annotations

import time

from app.config import get_settings
from app.database import SessionLocal
from app.jobs import claim_next_job, mark_job_completed, mark_job_failed
from app.logging_utils import logger
from app.telegram_adapter import TelegramAdapter
from app.workflows import (
    JOB_TYPE_CLARIFICATION_REPARSE,
    JOB_TYPE_PARSE_SOURCE_MESSAGE,
    JOB_TYPE_SCHEDULED_BACKUP,
    JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS,
    JOB_TYPE_TELEGRAM_UPDATE,
    maybe_enqueue_scheduled_backup,
    notify_transaction_event,
    process_parse_source_message,
    process_scheduled_backup,
    reparse_draft_with_clarification,
    route_telegram_update,
)


def _handle_job(job, telegram: TelegramAdapter, db) -> None:
    if job.job_type == JOB_TYPE_TELEGRAM_UPDATE:
        route_telegram_update(db, job.payload, telegram)
        return

    if job.job_type == JOB_TYPE_PARSE_SOURCE_MESSAGE:
        process_parse_source_message(db, job.payload, telegram)
        return

    if job.job_type == JOB_TYPE_CLARIFICATION_REPARSE:
        reparse_draft_with_clarification(db, job.payload, telegram)
        return

    if job.job_type == JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS:
        notify_transaction_event(db, job.payload, telegram)
        return

    if job.job_type == JOB_TYPE_SCHEDULED_BACKUP:
        process_scheduled_backup(db, telegram)
        return

    logger.warn(
        "worker",
        "unknown_job_type",
        "Unknown job type received",
        {"jobId": job.id, "jobType": job.job_type},
    )


def main() -> None:
    settings = get_settings()
    telegram = TelegramAdapter(settings)
    logger.info("worker", "worker_started", "Python worker started", {"workerId": settings.worker_id})
    while True:
        with SessionLocal() as db:
            maybe_enqueue_scheduled_backup(db, settings)
            job = claim_next_job(db)
            if not job:
                time.sleep(settings.worker_poll_interval_seconds)
                continue

            try:
                _handle_job(job, telegram, db)
                mark_job_completed(db, job)
            except Exception as exc:  # pragma: no cover
                logger.error("worker", "job_failed", "Job failed", {"jobId": job.id, "error": exc})
                mark_job_failed(db, job, exc)


if __name__ == "__main__":
    main()
