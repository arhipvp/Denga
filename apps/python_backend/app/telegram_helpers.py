from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models import CategoryType
from app.telegram_types import ActiveCategory, ParsedTransaction, ReviewDraft


TELEGRAM_ADD_OPERATION_MENU_LABEL = "Добавить операцию"
TELEGRAM_STATS_MENU_LABEL = "Посмотреть статистику"
TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK = "stats:expense-current-month"
TELEGRAM_INCOME_CURRENT_MONTH_CALLBACK = "stats:income-current-month"
CATEGORY_PAGE_SIZE = 8
CATEGORY_PARENT_PAGE_CALLBACK_PREFIX = "draft:category-parent-page:"
CATEGORY_PARENT_CALLBACK_PREFIX = "draft:category-parent:"
CATEGORY_LEAF_PAGE_CALLBACK_PREFIX = "draft:category-leaf-page:"


def create_main_menu_reply_markup() -> dict:
    return {
        "keyboard": [[
            {"text": TELEGRAM_ADD_OPERATION_MENU_LABEL},
            {"text": TELEGRAM_STATS_MENU_LABEL},
        ]],
        "resize_keyboard": True,
        "is_persistent": True,
    }


def create_stats_submenu_reply_markup() -> dict:
    return {
        "inline_keyboard": [
            [{"text": "Расходы за этот месяц", "callback_data": TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK}],
            [{"text": "Доходы за этот месяц", "callback_data": TELEGRAM_INCOME_CURRENT_MONTH_CALLBACK}],
        ]
    }


def is_start_command(text: str) -> bool:
    command = text.strip().split(maxsplit=1)[0].lower() if text.strip() else ""
    return command == "/start" or command.startswith("/start@")


def is_add_operation_menu_action(text: str) -> bool:
    return text.strip() == TELEGRAM_ADD_OPERATION_MENU_LABEL


def is_stats_menu_action(text: str) -> bool:
    return text.strip() == TELEGRAM_STATS_MENU_LABEL


def is_cancel_command(text: str) -> bool:
    return text.strip().lower() in {"отмена", "стоп", "cancel", "/cancel"}


def normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    lower = value.lower()
    now = datetime.now(timezone.utc)
    if "вчера" in lower or "yesterday" in lower:
        return (now - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    if "завтра" in lower or "tomorrow" in lower:
        return (now + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    if any(token in lower for token in ("today", "current", "текущ", "сегодня")):
        return now.isoformat().replace("+00:00", "Z")
    if len(value) == 10 and value[4] == "-" and value[7] == "-":
        return f"{value}T00:00:00.000Z"
    if "t" in value.lower() and not value.endswith("Z"):
        return f"{value}Z"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_category_candidate(candidate: str | None, categories: list[ActiveCategory]) -> str | None:
    if not candidate:
        return None
    normalized = candidate.strip().lower()
    for item in categories:
        if item.display_path.strip().lower() == normalized:
            return item.display_path
    return None


def apply_heuristics(
    parsed: ParsedTransaction,
    text: str,
    categories: list[ActiveCategory],
    default_currency: str,
) -> ParsedTransaction:
    normalized = text.lower()
    next_parsed = ParsedTransaction(
        type=parsed.type,
        amount=parsed.amount,
        occurred_at=parsed.occurred_at,
        category_candidate=parsed.category_candidate,
        comment=parsed.comment,
        confidence=parsed.confidence,
        ambiguities=list(parsed.ambiguities),
        follow_up_question=parsed.follow_up_question,
        resolved_currency=parsed.resolved_currency or default_currency,
    )
    if next_parsed.amount is None:
        import re
        match = re.search(r"(\d+(?:[.,]\d+)?)", normalized)
        if match:
            next_parsed.amount = float(match.group(1).replace(",", "."))
    if next_parsed.type is None:
        if any(token in normalized for token in ("зарплат", "доход", "получил", "получила", "пришло", "преми")):
            next_parsed.type = "income"
        elif any(token in normalized for token in ("добавь", "купил", "купила", "такси", "еда", "продукт", "заплат", "расход")):
            next_parsed.type = "expense"
    next_parsed.occurred_at = normalize_date(next_parsed.occurred_at) or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not next_parsed.category_candidate:
        hints: list[tuple[tuple[str, ...], str]] = [
            (("такси", "метро", "автобус", "транспорт", "uber", "яндекс go"), "транспорт"),
            (("lidl", "aldi", "kaufland", "spar", "tesco", "ашан", "пятерочк", "перекрест", "магнит", "дикси", "продукт", "еда", "магазин", "кофе", "ресторан"), "продукт"),
            (("дом", "квартир", "аренд", "жкх"), "дом"),
            (("врач", "аптек", "лекарств", "здоров"), "здоров"),
            (("зарплат", "доход", "преми", "гонорар"), "доход"),
        ]
        for needles, token in hints:
            candidate = next(
                (
                    item for item in categories
                    if any(needle in normalized for needle in needles)
                    and token in item.display_path.lower()
                    and (
                        not next_parsed.type
                        or item.type == (CategoryType.INCOME if next_parsed.type == "income" else CategoryType.EXPENSE)
                    )
                ),
                None,
            )
            if candidate:
                next_parsed.category_candidate = candidate.display_path
                break
    next_parsed.ambiguities = [
        item for item in next_parsed.ambiguities
        if not (
            (next_parsed.type and "type" in item.lower())
            or (next_parsed.amount and "amount" in item.lower())
            or (next_parsed.occurred_at and "date" in item.lower())
            or (next_parsed.category_candidate and "categor" in item.lower())
        )
    ]
    return next_parsed


def create_draft_payload(
    parsed: ParsedTransaction,
    input_text: str,
    default_currency: str,
    categories: list[ActiveCategory],
) -> ReviewDraft:
    normalized_name = normalize_category_candidate(parsed.category_candidate, categories)
    category = next((item for item in categories if item.display_path.lower() == (normalized_name or "").lower()), None)
    return ReviewDraft(
        type=parsed.type,
        amount=parsed.amount,
        occurred_at=normalize_date(parsed.occurred_at) or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        category_id=category.id if category else None,
        category_name=category.display_path if category else None,
        comment=parsed.comment or input_text or None,
        currency=parsed.resolved_currency or default_currency,
        confidence=parsed.confidence,
        ambiguities=parsed.ambiguities,
        follow_up_question=parsed.follow_up_question,
        source_text=input_text,
    )


def merge_draft_with_parsed(
    current: ReviewDraft,
    parsed: ParsedTransaction,
    input_text: str,
    default_currency: str,
    categories: list[ActiveCategory],
) -> ReviewDraft:
    next_draft = create_draft_payload(parsed, input_text, default_currency, categories)
    return ReviewDraft(
        type=next_draft.type or current.type,
        amount=next_draft.amount if next_draft.amount is not None else current.amount,
        occurred_at=next_draft.occurred_at or current.occurred_at,
        category_id=next_draft.category_id or current.category_id,
        category_name=next_draft.category_name or current.category_name,
        comment=next_draft.comment or current.comment,
        currency=next_draft.currency or current.currency or default_currency,
        confidence=max(current.confidence or 0, next_draft.confidence or 0),
        ambiguities=next_draft.ambiguities,
        follow_up_question=next_draft.follow_up_question or current.follow_up_question,
        source_text="\n".join(item for item in (current.source_text, input_text) if item),
    )


def get_missing_draft_fields(draft: ReviewDraft) -> list[str]:
    return [
        label
        for label, value in (
            ("тип", draft.type),
            ("сумма", draft.amount),
            ("дата", draft.occurred_at),
            ("категория", draft.category_id),
        )
        if not value
    ]


def render_draft_text(draft: ReviewDraft, confirmed: bool) -> str:
    missing = get_missing_draft_fields(draft)
    type_label = "Доход" if draft.type == "income" else "Расход" if draft.type == "expense" else "Не определено"
    date_label = "Не определено"
    if draft.occurred_at:
        try:
            date_label = datetime.fromisoformat(draft.occurred_at.replace("Z", "+00:00")).strftime("%d.%m.%Y")
        except ValueError:
            date_label = draft.occurred_at
    lines = [
        "✅ Операция сохранена" if confirmed else ("❓ Нужно уточнить операцию" if missing else "🔎 Проверьте операцию перед сохранением"),
        "",
        f"📌 Тип: {type_label}",
        f"💶 Сумма: {draft.amount if draft.amount is not None else 'Не определено'} {draft.currency or ''}".strip(),
        f"📅 Дата: {date_label}",
        f"🏷️ Категория: {draft.category_name or 'Не определено'}",
        f"💬 Комментарий: {draft.comment or 'Не определено'}",
    ]
    if not confirmed and missing:
        lines.extend([
            "",
            f"Не хватает: {', '.join(missing)}.",
            f"Уточнение: {draft.follow_up_question}" if draft.follow_up_question else "Можно ответить сообщением в чат или исправить поля кнопками ниже.",
        ])
    return "\n".join(lines)


def create_draft_keyboard() -> dict:
    return {
        "inline_keyboard": [
            [{"text": "✅ Подтвердить", "callback_data": "draft:confirm"}, {"text": "❌ Отменить", "callback_data": "draft:cancel"}],
            [{"text": "🔁 Изменить тип", "callback_data": "draft:edit:type"}, {"text": "💶 Изменить сумму", "callback_data": "draft:edit:amount"}],
            [{"text": "📅 Изменить дату", "callback_data": "draft:edit:date"}, {"text": "🏷️ Изменить категорию", "callback_data": "draft:edit:category"}],
            [{"text": "💬 Изменить комментарий", "callback_data": "draft:edit:comment"}],
        ]
    }


def build_category_picker_page(
    categories: list[ActiveCategory],
    requested_page: int,
    *,
    parent_id: str | None = None,
    parent_page: int = 0,
) -> dict | None:
    if not categories:
        return None
    if parent_id is None:
        parents = []
        seen_parent_ids: set[str] = set()
        for item in categories:
            if item.parent_id in seen_parent_ids:
                continue
            seen_parent_ids.add(item.parent_id)
            parents.append({"id": item.parent_id, "name": item.parent_name})
        parents.sort(key=lambda item: item["name"].lower())

        total_pages = (len(parents) + CATEGORY_PAGE_SIZE - 1) // CATEGORY_PAGE_SIZE
        current_page = min(max(0, requested_page), total_pages - 1)
        start = current_page * CATEGORY_PAGE_SIZE
        page_items = parents[start:start + CATEGORY_PAGE_SIZE]
        keyboard = [
            [
                {
                    "text": item["name"],
                    "callback_data": f"{CATEGORY_PARENT_CALLBACK_PREFIX}{item['id']}:{current_page}",
                }
            ]
            for item in page_items
        ]
        pagination_row: list[dict] = []
        if current_page > 0:
            pagination_row.append({"text": "Назад", "callback_data": f"{CATEGORY_PARENT_PAGE_CALLBACK_PREFIX}{current_page - 1}"})
        if current_page < total_pages - 1:
            pagination_row.append({"text": "Вперед", "callback_data": f"{CATEGORY_PARENT_PAGE_CALLBACK_PREFIX}{current_page + 1}"})
        if pagination_row:
            keyboard.append(pagination_row)
        return {
            "text": (
                f"Выберите главную категорию (страница {current_page + 1}/{total_pages}):"
                if total_pages > 1
                else "Выберите главную категорию:"
            ),
            "replyMarkup": {"inline_keyboard": keyboard},
        }

    leaf_items = [item for item in categories if item.parent_id == parent_id]
    if not leaf_items:
        return None
    leaf_items.sort(key=lambda item: item.name.lower())
    total_pages = (len(leaf_items) + CATEGORY_PAGE_SIZE - 1) // CATEGORY_PAGE_SIZE
    current_page = min(max(0, requested_page), total_pages - 1)
    start = current_page * CATEGORY_PAGE_SIZE
    page_items = leaf_items[start:start + CATEGORY_PAGE_SIZE]
    keyboard = [[{"text": item.name, "callback_data": f"draft:set-category:{item.id}"}] for item in page_items]
    pagination_row: list[dict] = []
    if current_page > 0:
        pagination_row.append(
            {
                "text": "Назад",
                "callback_data": f"{CATEGORY_LEAF_PAGE_CALLBACK_PREFIX}{parent_id}:{parent_page}:{current_page - 1}",
            }
        )
    if current_page < total_pages - 1:
        pagination_row.append(
            {
                "text": "Вперед",
                "callback_data": f"{CATEGORY_LEAF_PAGE_CALLBACK_PREFIX}{parent_id}:{parent_page}:{current_page + 1}",
            }
        )
    if pagination_row:
        keyboard.append(pagination_row)
    keyboard.append([{"text": "К главным категориям", "callback_data": f"{CATEGORY_PARENT_PAGE_CALLBACK_PREFIX}{parent_page}"}])
    return {
        "text": (
            f"Выберите подкатегорию «{leaf_items[0].parent_name}» (страница {current_page + 1}/{total_pages}):"
            if total_pages > 1
            else f"Выберите подкатегорию «{leaf_items[0].parent_name}»:"
        ),
        "replyMarkup": {"inline_keyboard": keyboard},
    }
