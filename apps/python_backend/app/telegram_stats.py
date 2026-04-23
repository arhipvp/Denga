from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Transaction, TransactionStatus, TransactionType, Category
from app.services_core import bootstrap_household_id, get_settings_payload
from app.summary import SummaryTransaction, calculate_current_month_category_breakdown
from app.telegram_adapter import TelegramAdapter
from app.telegram_stats_renderer import TelegramStatsRenderer


TELEGRAM_CAPTION_LIMIT = 1024


def _current_month_bounds(now: datetime) -> tuple[datetime, datetime]:
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
    return start, end


def get_current_month_category_breakdown(db: Session, type_: TransactionType) -> dict:
    settings = get_settings_payload(db)
    now = datetime.now(timezone.utc)
    start, end = _current_month_bounds(now)
    transactions = list(
        db.execute(
            select(Transaction)
            .where(
                Transaction.household_id == bootstrap_household_id(),
                Transaction.type == type_,
                Transaction.status == TransactionStatus.CONFIRMED,
                Transaction.occurred_at >= start.replace(tzinfo=None),
                Transaction.occurred_at < end.replace(tzinfo=None),
            )
            .options(joinedload(Transaction.category).joinedload(Category.parent))
            .order_by(Transaction.occurred_at.asc())
        ).scalars()
    )
    summary_transactions = [
        SummaryTransaction(
            id=item.id,
            type=item.type.value,
            status=item.status.value,
            amount=float(item.amount),
            occurred_at=item.occurred_at.replace(tzinfo=timezone.utc),
            category_id=item.category_id,
            category_name=item.category.name if item.category else None,
            parent_category_id=item.category.parent.id if item.category and item.category.parent else None,
            parent_category_name=item.category.parent.name if item.category and item.category.parent else None,
        )
        for item in transactions
    ]
    return calculate_current_month_category_breakdown(
        transactions=summary_transactions,
        period_start=start,
        currency=settings["defaultCurrency"],
        group_by="leaf",
    )


def _build_caption(input_: dict, report_title: str) -> str:
    details = _build_category_details(input_)
    lines = [
        f"<b>{report_title}</b>",
        f"Период: <b>{input_['periodLabel'].lower()}</b>",
        f"Итого: <b>{_format_money(input_['totalAmount'], input_['currency'])}</b>",
        "",
        "<b>Категории</b>",
        *details,
    ]
    return "\n".join(lines)


def _build_short_caption(input_: dict, report_title: str) -> str:
    return "\n".join(
        [
            f"<b>{report_title}</b>",
            f"Период: <b>{input_['periodLabel'].lower()}</b>",
            f"Итого: <b>{_format_money(input_['totalAmount'], input_['currency'])}</b>",
            "Полный список категорий отправлен следующим сообщением.",
        ]
    )


def _build_category_details(input_: dict) -> list[str]:
    return [
        f"{index}. {item['categoryName']} — <b>{_format_money(item['amount'], input_['currency'])}</b> ({(item['share'] * 100):.1f}%)"
        for index, item in enumerate(input_["fullItems"], start=1)
    ]


def _should_send_follow_up_details(input_: dict, full_caption: str) -> bool:
    if len(full_caption) > TELEGRAM_CAPTION_LIMIT:
        return True
    return len(input_["items"]) != len(input_["fullItems"])


def _format_money(value: float, currency: str) -> str:
    formatted = f"{value:,.2f}".replace(",", " ").replace(".", ",")
    return f"{formatted} {currency}"


def send_current_month_report(db: Session, telegram: TelegramAdapter, chat_id: str, *, type_: TransactionType) -> dict:
    definition = {
        TransactionType.EXPENSE: {
            "fileName": "expense-current-month.png",
            "chartTitle": "Расходы",
            "emptyText": "В этом месяце подтвержденных расходов пока нет.",
            "reportTitle": "Отчет по расходам",
        },
        TransactionType.INCOME: {
            "fileName": "income-current-month.png",
            "chartTitle": "Доходы",
            "emptyText": "В этом месяце подтвержденных доходов пока нет.",
            "reportTitle": "Отчет по доходам",
        },
    }[type_]
    breakdown = get_current_month_category_breakdown(db, type_)
    if breakdown["totalAmount"] <= 0 or len(breakdown["items"]) == 0:
        telegram.send_message(chat_id, definition["emptyText"])
        return {"accepted": True, "status": "stats_empty"}
    renderer = TelegramStatsRenderer()
    chart = renderer.render_category_breakdown(breakdown, definition["chartTitle"])
    full_caption = _build_caption(breakdown, definition["reportTitle"])
    short_caption = _build_short_caption(breakdown, definition["reportTitle"])
    send_follow_up_details = _should_send_follow_up_details(breakdown, full_caption)
    caption = full_caption if not send_follow_up_details else short_caption
    telegram.send_photo(chat_id=chat_id, file_name=definition["fileName"], photo=chart, caption=caption)
    if send_follow_up_details:
        telegram.send_message(chat_id, full_caption)
    return {"accepted": True, "status": "stats_sent"}
