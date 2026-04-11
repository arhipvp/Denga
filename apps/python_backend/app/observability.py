from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from contextvars import ContextVar
from time import perf_counter
from typing import Any, Iterator
from uuid import uuid4


_context: ContextVar[dict[str, Any]] = ContextVar("app_observability_context", default={})
_counters: Counter[str] = Counter()
_gauges: dict[str, float] = {}


def get_log_context() -> dict[str, Any]:
    return dict(_context.get())


def set_log_context(**values: Any) -> dict[str, Any]:
    merged = get_log_context()
    for key, value in values.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    _context.set(merged)
    return merged


@contextmanager
def bind_log_context(**values: Any) -> Iterator[dict[str, Any]]:
    token = _context.set({**get_log_context(), **{key: value for key, value in values.items() if value is not None}})
    try:
        yield _context.get()
    finally:
        _context.reset(token)


def ensure_request_context(request_id: str | None = None, correlation_id: str | None = None) -> dict[str, str]:
    request_id = request_id or uuid4().hex
    correlation_id = correlation_id or request_id
    set_log_context(request_id=request_id, correlation_id=correlation_id)
    return {"request_id": request_id, "correlation_id": correlation_id}


def increment_metric(name: str, amount: int = 1) -> None:
    _counters[name] += amount


def set_gauge(name: str, value: float) -> None:
    _gauges[name] = value


def metrics_snapshot() -> dict[str, Any]:
    return {
        "counters": dict(_counters),
        "gauges": dict(_gauges),
    }


@contextmanager
def record_duration(metric_name: str) -> Iterator[None]:
    started_at = perf_counter()
    try:
        yield
    finally:
        duration_ms = (perf_counter() - started_at) * 1000
        set_gauge(metric_name, duration_ms)
