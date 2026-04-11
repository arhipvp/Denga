from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Job
from app.repositories.job_repository import JobRepository


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_enqueue_deduplicates_active_jobs() -> None:
    with _make_session() as db:
        repo = JobRepository(db)
        first = repo.enqueue(job_type="telegram_update", payload={"update_id": 1}, household_id="house", dedupe_key="telegram-update:1")
        second = repo.enqueue(job_type="telegram_update", payload={"update_id": 1}, household_id="house", dedupe_key="telegram-update:1")

        assert first.id == second.id


def test_claim_reclaims_expired_running_job() -> None:
    with _make_session() as db:
        job = Job(
            household_id="house",
            job_type="parse_source_message",
            status="running",
            payload={"sourceMessageId": "source-1"},
            attempts=0,
            max_attempts=3,
            lease_expires_at=datetime.utcnow() - timedelta(seconds=1),
        )
        db.add(job)
        db.commit()

        claimed = JobRepository(db).claim_next()

        assert claimed is not None
        assert claimed.id == job.id
        assert claimed.status == "running"
        assert claimed.lease_expires_at is not None


def test_failed_job_moves_to_dead_letter_after_max_attempts() -> None:
    with _make_session() as db:
        repo = JobRepository(db)
        job = repo.enqueue(job_type="parse_source_message", payload={"sourceMessageId": "source-1"}, household_id="house", max_attempts=1)
        claimed = repo.claim_next()
        assert claimed is not None

        repo.mark_failed(claimed, RuntimeError("boom"))

        assert claimed.status == "dead_letter"
