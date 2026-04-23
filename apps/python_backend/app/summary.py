from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone


UNCATEGORIZED_LABEL = "Без категории"


@dataclass(slots=True)
class SummaryTransaction:
    id: str
    type: str
    status: str
    amount: float
    occurred_at: datetime
    category_id: str | None
    category_name: str | None
    parent_category_id: str | None
    parent_category_name: str | None


def _month_key(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_keys(now: datetime, count: int = 6) -> list[str]:
    year = now.year
    month = now.month
    result: list[str] = []
    for offset in range(count - 1, -1, -1):
        current_month = month - offset
        current_year = year
        while current_month <= 0:
            current_month += 12
            current_year -= 1
        result.append(f"{current_year:04d}-{current_month:02d}")
    return result


def calculate_transaction_summary(
    transactions: list[SummaryTransaction],
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    current_period_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    next_period_start = datetime(
        now.year + (1 if now.month == 12 else 0),
        1 if now.month == 12 else now.month + 1,
        1,
        tzinfo=timezone.utc,
    )
    previous_period_start = datetime(
        now.year - (1 if now.month == 1 else 0),
        12 if now.month == 1 else now.month - 1,
        1,
        tzinfo=timezone.utc,
    )

    monthly = {
        key: {"month": key, "income": 0.0, "expense": 0.0, "net": 0.0}
        for key in _month_keys(now)
    }
    expense_categories: dict[str, dict] = {}
    income_categories: dict[str, dict] = {}
    current = {"income": 0.0, "expense": 0.0, "balance": 0.0}
    previous = {"income": 0.0, "expense": 0.0, "balance": 0.0}
    counts = {"operations": 0, "income": 0, "expense": 0, "cancelled": 0}
    average = defaultdict(float)

    for item in transactions:
        occurred_at = item.occurred_at
        month_key = _month_key(occurred_at)
        is_current = current_period_start <= occurred_at < next_period_start
        is_previous = previous_period_start <= occurred_at < current_period_start

        if item.status == "CANCELLED" and is_current:
            counts["cancelled"] += 1

        if item.status != "CONFIRMED":
            continue

        if month_key in monthly:
            if item.type == "INCOME":
                monthly[month_key]["income"] += item.amount
                monthly[month_key]["net"] += item.amount
            else:
                monthly[month_key]["expense"] += item.amount
                monthly[month_key]["net"] -= item.amount

        if is_current:
            counts["operations"] += 1
            average["total"] += item.amount
            average["total_count"] += 1
            if item.type == "INCOME":
                counts["income"] += 1
                current["income"] += item.amount
                current["balance"] += item.amount
                average["income_total"] += item.amount
                average["income_count"] += 1
                target = income_categories
            else:
                counts["expense"] += 1
                current["expense"] += item.amount
                current["balance"] -= item.amount
                average["expense_total"] += item.amount
                average["expense_count"] += 1
                target = expense_categories

            category_key = item.parent_category_id or item.category_id or item.type
            if category_key not in target:
                target[category_key] = {
                    "categoryId": item.parent_category_id or item.category_id,
                    "categoryName": item.parent_category_name or item.category_name or UNCATEGORIZED_LABEL,
                    "amount": 0.0,
                }
            target[category_key]["amount"] += item.amount

        if is_previous:
            if item.type == "INCOME":
                previous["income"] += item.amount
                previous["balance"] += item.amount
            else:
                previous["expense"] += item.amount
                previous["balance"] -= item.amount

    def build_top_categories(source: dict[str, dict], total: float) -> list[dict]:
        items = sorted(source.values(), key=lambda item: item["amount"], reverse=True)[:5]
        return [
            {
                **item,
                "share": (item["amount"] / total) if total > 0 else 0.0,
            }
            for item in items
        ]

    return {
        "totals": {
            "currentPeriod": current,
            "previousPeriod": previous,
        },
        "diffs": {
            "income": current["income"] - previous["income"],
            "expense": current["expense"] - previous["expense"],
            "balance": current["balance"] - previous["balance"],
        },
        "counts": counts,
        "average": {
            "income": (average["income_total"] / average["income_count"]) if average["income_count"] else 0.0,
            "expense": (average["expense_total"] / average["expense_count"]) if average["expense_count"] else 0.0,
            "transaction": (average["total"] / average["total_count"]) if average["total_count"] else 0.0,
        },
        "topExpenseCategories": build_top_categories(expense_categories, current["expense"]),
        "topIncomeCategories": build_top_categories(income_categories, current["income"]),
        "monthly": list(monthly.values()),
    }


def format_current_month_label(date: datetime) -> str:
    months = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
    ]
    return f"{months[date.month - 1]} {date.year}"


def calculate_current_month_category_breakdown(
    *,
    transactions: list[SummaryTransaction],
    period_start: datetime,
    currency: str,
    minimum_visible_share: float = 0.05,
    group_by: str = "parent",
) -> dict:
    total_amount = sum(item.amount for item in transactions)
    category_map: dict[str, dict] = {}
    for item in transactions:
        if group_by == "leaf":
            category_key = item.category_id or item.parent_category_id or f"uncategorized-{item.type.lower()}"
            category_id = item.category_id or item.parent_category_id
            category_name = (
                f"{item.parent_category_name} / {item.category_name}"
                if item.parent_category_name and item.category_name
                else item.category_name or item.parent_category_name or UNCATEGORIZED_LABEL
            )
        else:
            category_key = item.parent_category_id or item.category_id or f"uncategorized-{item.type.lower()}"
            category_id = item.parent_category_id or item.category_id
            category_name = item.parent_category_name or item.category_name or UNCATEGORIZED_LABEL
        if category_key not in category_map:
            category_map[category_key] = {
                "categoryId": category_id,
                "categoryName": category_name,
                "amount": 0.0,
            }
        category_map[category_key]["amount"] += item.amount

    sorted_items = [
        {
            **item,
            "share": (item["amount"] / total_amount) if total_amount > 0 else 0.0,
        }
        for item in sorted(category_map.values(), key=lambda current: current["amount"], reverse=True)
    ]
    full_items = [{**item} for item in sorted_items]
    visible_items = [{**item} for item in sorted_items]
    other_amount = 0.0
    hidden_count = 0
    for index in range(len(sorted_items) - 1, -1, -1):
        next_amount = other_amount + sorted_items[index]["amount"]
        next_share = (next_amount / total_amount) if total_amount > 0 else 0.0
        if next_share > minimum_visible_share:
            break
        other_amount = next_amount
        hidden_count += 1
    if hidden_count > 0:
        visible_items = visible_items[: len(visible_items) - hidden_count]
        visible_items.append(
            {
                "categoryId": None,
                "categoryName": "Прочие категории",
                "amount": other_amount,
                "share": (other_amount / total_amount) if total_amount > 0 else 0.0,
                "isOther": True,
            }
        )

    return {
        "periodLabel": format_current_month_label(period_start),
        "currency": currency,
        "totalAmount": total_amount,
        "items": visible_items,
        "fullItems": full_items,
    }
