from __future__ import annotations

import time

from app.config import get_settings
from app.database import SessionLocal
from app.jobs import claim_next_job, mark_job_completed, mark_job_failed
from app.logging_utils import logger


def _handle_job(job) -> None:
    if job.job_type == "telegram_update":
        logger.warn(
            "worker",
            "telegram_update_unimplemented",
            "Telegram update handler is not implemented in Python worker yet",
            {"jobId": job.id},
        )
        return

    if job.job_type == "scheduled_backup":
        logger.warn(
            "worker",
            "scheduled_backup_unimplemented",
            "Scheduled backup handler is not implemented in Python worker yet",
            {"jobId": job.id},
        )
        return

    logger.warn(
        "worker",
        "unknown_job_type",
        "Unknown job type received",
        {"jobId": job.id, "jobType": job.job_type},
    )


def main() -> None:
    settings = get_settings()
    logger.info("worker", "worker_started", "Python worker started", {"workerId": settings.worker_id})
    while True:
        with SessionLocal() as db:
            job = claim_next_job(db)
            if not job:
                time.sleep(settings.worker_poll_interval_seconds)
                continue

            try:
                _handle_job(job)
                mark_job_completed(db, job)
            except Exception as exc:  # pragma: no cover
                logger.error("worker", "job_failed", "Job failed", {"jobId": job.id, "error": exc})
                mark_job_failed(db, job, exc)


if __name__ == "__main__":
    main()
