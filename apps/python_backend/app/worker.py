from __future__ import annotations

import time
from collections.abc import Callable

from app.config import get_settings
from app.database import SessionLocal
from app.jobs import claim_next_job, enqueue_job, mark_job_completed, mark_job_failed
from app.logging_utils import logger
from app.observability import bind_log_context, increment_metric, set_gauge
from app.repositories.job_repository import JobRepository
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

POLLING_RETRY_DELAY_SECONDS = 30


JobHandler = Callable[[object, TelegramAdapter, object], None]


def _build_job_registry() -> dict[str, JobHandler]:
    return {
        JOB_TYPE_TELEGRAM_UPDATE: lambda job, telegram, db: route_telegram_update(db, job.payload, telegram),
        JOB_TYPE_PARSE_SOURCE_MESSAGE: lambda job, telegram, db: process_parse_source_message(db, job.payload, telegram),
        JOB_TYPE_CLARIFICATION_REPARSE: lambda job, telegram, db: reparse_draft_with_clarification(db, job.payload, telegram),
        JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS: lambda job, telegram, db: notify_transaction_event(db, job.payload, telegram),
        JOB_TYPE_SCHEDULED_BACKUP: lambda job, telegram, db: process_scheduled_backup(db, telegram),
    }


def _poll_telegram_updates(db, telegram: TelegramAdapter, offset: int | None) -> int | None:
    if get_settings().telegram_mode != "polling" or not get_settings().telegram_bot_token:
        return offset
    updates = telegram.get_updates(offset=offset, timeout=1)
    next_offset = offset
    for update in updates:
        update_id = update.get("update_id")
        enqueue_job(
            db,
            job_type=JOB_TYPE_TELEGRAM_UPDATE,
            payload=update,
            household_id=get_settings().bootstrap_household_id,
        )
        increment_metric("telegram.polling_updates_enqueued")
        if isinstance(update_id, int):
            next_offset = update_id + 1
    return next_offset


def main() -> None:
    settings = get_settings()
    telegram = TelegramAdapter(settings)
    job_registry = _build_job_registry()
    polling_offset: int | None = None
    polling_backoff_until = 0.0
    logger.info("worker", "worker_started", "Python worker started", {"workerId": settings.worker_id})
    while True:
        with SessionLocal() as db:
            if settings.telegram_mode == "polling" and settings.telegram_bot_token and time.time() >= polling_backoff_until:
                try:
                    polling_offset = _poll_telegram_updates(db, telegram, polling_offset)
                except Exception as exc:
                    polling_backoff_until = time.time() + POLLING_RETRY_DELAY_SECONDS
                    increment_metric("telegram.polling_failures")
                    logger.error(
                        "telegram",
                        "polling_failed",
                        "Telegram polling launch failed",
                        {"error": exc, "retryDelaySeconds": POLLING_RETRY_DELAY_SECONDS},
                    )
            maybe_enqueue_scheduled_backup(db, settings)
            job = claim_next_job(db)
            queue_metrics = JobRepository(db).queue_metrics()
            set_gauge("jobs.pending", queue_metrics["pendingCount"])
            set_gauge("jobs.running", queue_metrics["runningCount"])
            set_gauge("jobs.dead_letter", queue_metrics["deadLetterCount"])
            set_gauge("jobs.oldest_pending_lag_seconds", queue_metrics["oldestPendingLagSeconds"])
            if not job:
                time.sleep(settings.worker_poll_interval_seconds)
                continue

            try:
                increment_metric("jobs.claimed")
                handler = job_registry.get(job.job_type)
                if handler is None:
                    logger.warn("worker", "unknown_job_type", "Unknown job type received", {"jobId": job.id, "jobType": job.job_type})
                    mark_job_completed(db, job)
                    continue
                log_context = {
                    "job_id": job.id,
                    "job_type": job.job_type,
                    "worker_id": settings.worker_id,
                    "correlation_id": job.correlation_id or job.id,
                }
                if settings.feature_enhanced_observability_enabled:
                    log_context["job_attempt"] = job.attempts + 1
                    log_context["household_id"] = job.household_id
                with bind_log_context(**log_context):
                    handler(job, telegram, db)
                mark_job_completed(db, job)
                increment_metric("jobs.completed")
            except Exception as exc:  # pragma: no cover
                increment_metric("jobs.failed")
                logger.error("worker", "job_failed", "Job failed", {"jobId": job.id, "error": exc})
                mark_job_failed(db, job, exc)


if __name__ == "__main__":
    main()
