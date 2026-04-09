from app.models import CategoryType
from app.telegram_helpers import (
    apply_heuristics,
    build_category_picker_page,
    create_draft_payload,
    get_missing_draft_fields,
    normalize_date,
    render_draft_text,
)
from app.telegram_types import ActiveCategory, ParsedTransaction


def _expense_category() -> list[ActiveCategory]:
    return [
        ActiveCategory(
            id="cat-1",
            name="Такси",
            type=CategoryType.EXPENSE,
            parent_id="parent-1",
            parent_name="Транспорт",
            display_path="Транспорт / Такси",
        )
    ]


def _hierarchical_categories() -> list[ActiveCategory]:
    return [
        ActiveCategory(
            id="cat-1",
            name="Такси",
            type=CategoryType.EXPENSE,
            parent_id="parent-1",
            parent_name="Транспорт",
            display_path="Транспорт / Такси",
        ),
        ActiveCategory(
            id="cat-2",
            name="Метро",
            type=CategoryType.EXPENSE,
            parent_id="parent-1",
            parent_name="Транспорт",
            display_path="Транспорт / Метро",
        ),
        ActiveCategory(
            id="cat-3",
            name="Кофе",
            type=CategoryType.EXPENSE,
            parent_id="parent-2",
            parent_name="Еда",
            display_path="Еда / Кофе",
        ),
    ]


def test_apply_heuristics_infers_amount_type_and_category() -> None:
    parsed = ParsedTransaction(
        type=None,
        amount=None,
        occurred_at=None,
        category_candidate=None,
        comment=None,
        confidence=0.2,
        ambiguities=["type", "amount", "category"],
        follow_up_question=None,
        resolved_currency=None,
    )
    result = apply_heuristics(parsed, "Такси 12 EUR", _expense_category(), "EUR")
    assert result.type == "expense"
    assert result.amount == 12
    assert result.category_candidate == "Транспорт / Такси"
    assert result.resolved_currency == "EUR"


def test_create_draft_payload_and_render_text() -> None:
    draft = create_draft_payload(
        ParsedTransaction(
            type="expense",
            amount=12.5,
            occurred_at="2026-04-09",
            category_candidate="Транспорт / Такси",
            comment="Такси",
            confidence=0.9,
            ambiguities=[],
            follow_up_question=None,
            resolved_currency="EUR",
        ),
        "Такси 12.5",
        "EUR",
        _expense_category(),
    )
    text = render_draft_text(draft, confirmed=False)
    assert draft.category_id == "cat-1"
    assert "Проверьте операцию перед сохранением" in text
    assert "Транспорт / Такси" in text


def test_missing_fields_and_category_picker_page() -> None:
    draft = create_draft_payload(
        ParsedTransaction(
            type=None,
            amount=None,
            occurred_at=None,
            category_candidate=None,
            comment=None,
            confidence=0.1,
            ambiguities=["type", "amount", "date", "category"],
            follow_up_question="Уточните операцию",
            resolved_currency="EUR",
        ),
        "",
        "EUR",
        _expense_category(),
    )
    missing = get_missing_draft_fields(draft)
    picker = build_category_picker_page(_expense_category(), 0, parent_id=None, parent_page=0)
    assert "тип" in missing
    assert "сумма" in missing
    assert picker is not None
    assert "Выберите главную категорию" in picker["text"]


def test_category_picker_supports_parent_and_child_navigation() -> None:
    parent_picker = build_category_picker_page(_hierarchical_categories(), 0, parent_id=None, parent_page=0)
    assert parent_picker is not None
    assert parent_picker["replyMarkup"]["inline_keyboard"][0][0]["text"] == "Еда"
    assert parent_picker["replyMarkup"]["inline_keyboard"][1][0]["text"] == "Транспорт"

    child_picker = build_category_picker_page(
        _hierarchical_categories(),
        0,
        parent_id="parent-1",
        parent_page=0,
    )
    assert child_picker is not None
    assert "Выберите подкатегорию" in child_picker["text"]
    assert child_picker["replyMarkup"]["inline_keyboard"][0][0]["text"] == "Метро"
    assert child_picker["replyMarkup"]["inline_keyboard"][1][0]["text"] == "Такси"
    assert child_picker["replyMarkup"]["inline_keyboard"][-1][0]["text"] == "К главным категориям"


def test_normalize_date_handles_relative_values() -> None:
    assert normalize_date("2026-04-09") == "2026-04-09T00:00:00.000Z"
    assert normalize_date("today") is not None
