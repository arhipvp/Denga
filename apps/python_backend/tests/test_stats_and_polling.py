from datetime import datetime, timezone

import app.worker as worker_module
from app.config import get_settings
from app.summary import SummaryTransaction, calculate_current_month_category_breakdown
from app.telegram_stats_renderer import TelegramStatsRenderer


def test_calculate_current_month_category_breakdown_aggregates_other_bucket() -> None:
    breakdown = calculate_current_month_category_breakdown(
        transactions=[
            SummaryTransaction("1", "EXPENSE", "CONFIRMED", 100, datetime(2026, 4, 1, tzinfo=timezone.utc), "c1", "Leaf 1", "p1", "Parent 1"),
            SummaryTransaction("2", "EXPENSE", "CONFIRMED", 3, datetime(2026, 4, 2, tzinfo=timezone.utc), "c2", "Leaf 2", "p2", "Parent 2"),
            SummaryTransaction("3", "EXPENSE", "CONFIRMED", 2, datetime(2026, 4, 3, tzinfo=timezone.utc), "c3", "Leaf 3", "p3", "Parent 3"),
        ],
        period_start=datetime(2026, 4, 1, tzinfo=timezone.utc),
        currency="EUR",
        minimum_visible_share=0.05,
    )
    assert breakdown["totalAmount"] == 105
    assert breakdown["items"][-1]["categoryName"] == "Прочие категории"
    assert len(breakdown["fullItems"]) == 3


def test_renderer_returns_png_bytes() -> None:
    renderer = TelegramStatsRenderer()
    payload = {
        "periodLabel": "Апрель 2026",
        "currency": "EUR",
        "totalAmount": 120.0,
        "items": [
            {"categoryName": "Транспорт", "amount": 80.0, "share": 0.666, "isOther": False},
            {"categoryName": "Прочие категории", "amount": 40.0, "share": 0.334, "isOther": True},
        ],
        "fullItems": [
            {"categoryName": "Транспорт", "amount": 80.0, "share": 0.666},
            {"categoryName": "Еда", "amount": 40.0, "share": 0.334},
        ],
    }
    image = renderer.render_category_breakdown(payload, "Расходы")
    assert image[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(image) > 1000


def test_polling_enqueues_updates(monkeypatch) -> None:
    monkeypatch.setenv("TELEGRAM_MODE", "polling")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "test-token")
    get_settings.cache_clear()
    captured: list[tuple[str, dict]] = []

    class FakeAdapter:
        def get_updates(self, *, offset=None, timeout=1):
            return [{"update_id": 10, "message": {"message_id": 1}}]

    def fake_enqueue_job(db, *, job_type, payload, household_id, not_before=None, max_attempts=3):
        captured.append((job_type, payload))
        return None

    monkeypatch.setattr(worker_module, "enqueue_job", fake_enqueue_job)
    next_offset = worker_module._poll_telegram_updates(object(), FakeAdapter(), None)
    assert next_offset == 11
    assert captured[0][0] == "telegram_update"
    get_settings.cache_clear()
