from __future__ import annotations

import app.telegram_stats as telegram_stats_module
from app.models import TransactionType


class FakeTelegram:
    def __init__(self) -> None:
        self.photos: list[dict] = []
        self.messages: list[tuple[str, str]] = []

    def send_photo(self, *, chat_id: str, file_name: str, photo: bytes, caption: str | None = None) -> dict:
        self.photos.append(
            {
                "chat_id": chat_id,
                "file_name": file_name,
                "photo": photo,
                "caption": caption,
            }
        )
        return {"message_id": 101}

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None = None) -> dict:
        self.messages.append((chat_id, text))
        return {"message_id": 202}


def test_income_report_includes_detailed_breakdown_in_caption_when_it_fits(monkeypatch) -> None:
    monkeypatch.setattr(
        telegram_stats_module,
        "get_current_month_category_breakdown",
        lambda db, type_: {
            "periodLabel": "Апрель 2026",
            "currency": "EUR",
            "totalAmount": 1800.0,
            "items": [
                {"categoryName": "Зарплата", "amount": 1500.0, "share": 0.8333},
                {"categoryName": "Бонус", "amount": 300.0, "share": 0.1667},
            ],
            "fullItems": [
                {"categoryName": "Зарплата", "amount": 1500.0, "share": 0.8333},
                {"categoryName": "Бонус", "amount": 300.0, "share": 0.1667},
            ],
        },
    )
    monkeypatch.setattr(telegram_stats_module.TelegramStatsRenderer, "render_category_breakdown", lambda self, breakdown, title: b"png")

    telegram = FakeTelegram()
    result = telegram_stats_module.send_current_month_report(object(), telegram, "42", type_=TransactionType.INCOME)

    assert result["status"] == "stats_sent"
    assert len(telegram.photos) == 1
    assert "1. Зарплата" in telegram.photos[0]["caption"]
    assert "2. Бонус" in telegram.photos[0]["caption"]
    assert telegram.messages == []


def test_telegram_report_requests_leaf_category_breakdown(monkeypatch) -> None:
    captured = {}

    def fake_breakdown(*, transactions, period_start, currency, minimum_visible_share=0.05, group_by="parent"):
        captured["group_by"] = group_by
        return {
            "periodLabel": "Апрель 2026",
            "currency": currency,
            "totalAmount": 0.0,
            "items": [],
            "fullItems": [],
        }

    monkeypatch.setattr(telegram_stats_module, "get_settings_payload", lambda db: {"defaultCurrency": "EUR"})
    monkeypatch.setattr(telegram_stats_module, "bootstrap_household_id", lambda: "house")
    monkeypatch.setattr(telegram_stats_module, "calculate_current_month_category_breakdown", fake_breakdown)

    class FakeScalars:
        def __iter__(self):
            return iter([])

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeDb:
        def execute(self, query):
            return FakeResult()

    telegram_stats_module.get_current_month_category_breakdown(FakeDb(), TransactionType.INCOME)

    assert captured["group_by"] == "leaf"


def test_income_report_sends_follow_up_details_when_caption_is_too_long(monkeypatch) -> None:
    monkeypatch.setattr(telegram_stats_module, "TELEGRAM_CAPTION_LIMIT", 120)
    monkeypatch.setattr(
        telegram_stats_module,
        "get_current_month_category_breakdown",
        lambda db, type_: {
            "periodLabel": "Апрель 2026",
            "currency": "EUR",
            "totalAmount": 2450.0,
            "items": [
                {"categoryName": "Основной доход", "amount": 1200.0, "share": 0.4898},
                {"categoryName": "Бонус проекта", "amount": 700.0, "share": 0.2857},
                {"categoryName": "Кэшбэк и возвраты", "amount": 550.0, "share": 0.2245},
            ],
            "fullItems": [
                {"categoryName": "Основной доход", "amount": 1200.0, "share": 0.4898},
                {"categoryName": "Бонус проекта", "amount": 700.0, "share": 0.2857},
                {"categoryName": "Кэшбэк и возвраты", "amount": 550.0, "share": 0.2245},
            ],
        },
    )
    monkeypatch.setattr(telegram_stats_module.TelegramStatsRenderer, "render_category_breakdown", lambda self, breakdown, title: b"png")

    telegram = FakeTelegram()
    telegram_stats_module.send_current_month_report(object(), telegram, "42", type_=TransactionType.INCOME)

    assert len(telegram.photos) == 1
    assert "Полный список категорий отправлен следующим сообщением." in telegram.photos[0]["caption"]
    assert len(telegram.messages) == 1
    assert "1. Основной доход" in telegram.messages[0][1]
    assert "3. Кэшбэк и возвраты" in telegram.messages[0][1]


def test_report_sends_follow_up_details_when_chart_collapses_other_categories(monkeypatch) -> None:
    monkeypatch.setattr(
        telegram_stats_module,
        "get_current_month_category_breakdown",
        lambda db, type_: {
            "periodLabel": "Апрель 2026",
            "currency": "EUR",
            "totalAmount": 105.0,
            "items": [
                {"categoryName": "Зарплата", "amount": 100.0, "share": 0.9524},
                {"categoryName": "Прочие категории", "amount": 5.0, "share": 0.0476, "isOther": True},
            ],
            "fullItems": [
                {"categoryName": "Зарплата", "amount": 100.0, "share": 0.9524},
                {"categoryName": "Подработка", "amount": 3.0, "share": 0.0286},
                {"categoryName": "Кэшбэк", "amount": 2.0, "share": 0.0190},
            ],
        },
    )
    monkeypatch.setattr(telegram_stats_module.TelegramStatsRenderer, "render_category_breakdown", lambda self, breakdown, title: b"png")

    telegram = FakeTelegram()
    telegram_stats_module.send_current_month_report(object(), telegram, "42", type_=TransactionType.INCOME)

    assert len(telegram.photos) == 1
    assert "Полный список категорий отправлен следующим сообщением." in telegram.photos[0]["caption"]
    assert len(telegram.messages) == 1
    assert "2. Подработка" in telegram.messages[0][1]
    assert "3. Кэшбэк" in telegram.messages[0][1]


def test_income_report_keeps_existing_empty_state(monkeypatch) -> None:
    monkeypatch.setattr(
        telegram_stats_module,
        "get_current_month_category_breakdown",
        lambda db, type_: {
            "periodLabel": "Апрель 2026",
            "currency": "EUR",
            "totalAmount": 0.0,
            "items": [],
            "fullItems": [],
        },
    )

    telegram = FakeTelegram()
    result = telegram_stats_module.send_current_month_report(object(), telegram, "42", type_=TransactionType.INCOME)

    assert result["status"] == "stats_empty"
    assert telegram.photos == []
    assert telegram.messages == [("42", "В этом месяце подтвержденных доходов пока нет.")]
