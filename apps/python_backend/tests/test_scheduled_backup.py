from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Job
from app.use_cases.scheduled_backup import maybe_enqueue_scheduled_backup

MOSCOW_TZ = timezone(timedelta(hours=3))


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _list_backup_jobs(db) -> list[Job]:
    return list(db.execute(select(Job).where(Job.job_type == "scheduled_backup").order_by(Job.created_at.asc())).scalars())


def test_scheduled_backup_enqueues_once_per_slot() -> None:
    with _make_session() as db:
        slot_time = datetime(2026, 4, 22, 12, 0, 5, tzinfo=MOSCOW_TZ)

        maybe_enqueue_scheduled_backup(db, now=slot_time)
        maybe_enqueue_scheduled_backup(db, now=slot_time.replace(second=45))

        jobs = _list_backup_jobs(db)
        assert len(jobs) == 1
        assert jobs[0].dedupe_key == "scheduled-backup:0 0 12 */3 * *:2026-04-22T09:00:00"


def test_scheduled_backup_does_not_reenqueue_after_completion_within_same_slot() -> None:
    with _make_session() as db:
        slot_time = datetime(2026, 4, 22, 12, 0, 5, tzinfo=MOSCOW_TZ)

        maybe_enqueue_scheduled_backup(db, now=slot_time)
        job = _list_backup_jobs(db)[0]
        job.status = "completed"
        db.commit()

        maybe_enqueue_scheduled_backup(db, now=slot_time.replace(second=55))

        assert len(_list_backup_jobs(db)) == 1


def test_scheduled_backup_enqueues_new_job_for_next_slot() -> None:
    with _make_session() as db:
        first_slot = datetime(2026, 4, 22, 12, 0, 0, tzinfo=MOSCOW_TZ)
        second_slot = datetime(2026, 4, 25, 12, 0, 0, tzinfo=MOSCOW_TZ)

        maybe_enqueue_scheduled_backup(db, now=first_slot)
        maybe_enqueue_scheduled_backup(db, now=second_slot)

        jobs = _list_backup_jobs(db)
        assert len(jobs) == 2
        assert jobs[0].dedupe_key != jobs[1].dedupe_key
