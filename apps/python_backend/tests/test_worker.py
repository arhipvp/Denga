from __future__ import annotations

import app.worker as worker_module


def test_handle_job_failure_rolls_back_before_logging(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []

    class FakeDb:
        def rollback(self) -> None:
            calls.append(("rollback", None))

    def fake_increment_metric(name: str) -> None:
        calls.append(("metric", name))

    def fake_log_error(source: str, event: str, message: str, context: dict[str, object]) -> None:
        calls.append(("log", context["jobId"]))

    monkeypatch.setattr(worker_module, "increment_metric", fake_increment_metric)
    monkeypatch.setattr(worker_module.logger, "error", fake_log_error)

    worker_module._handle_job_failure(FakeDb(), "job-123", RuntimeError("boom"))

    assert calls == [
        ("rollback", None),
        ("metric", "jobs.failed"),
        ("log", "job-123"),
    ]
