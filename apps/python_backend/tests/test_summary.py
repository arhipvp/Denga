from datetime import datetime, timezone

from app.summary import SummaryTransaction, calculate_transaction_summary


def test_calculate_transaction_summary_groups_current_and_previous_periods() -> None:
    payload = calculate_transaction_summary(
        [
            SummaryTransaction(
                id="1",
                type="INCOME",
                status="CONFIRMED",
                amount=1200,
                occurred_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
                category_id="salary",
                category_name="Salary",
                parent_category_id=None,
                parent_category_name=None,
            ),
            SummaryTransaction(
                id="2",
                type="EXPENSE",
                status="CONFIRMED",
                amount=400,
                occurred_at=datetime(2026, 4, 2, tzinfo=timezone.utc),
                category_id="food",
                category_name="Food",
                parent_category_id=None,
                parent_category_name=None,
            ),
            SummaryTransaction(
                id="3",
                type="EXPENSE",
                status="CONFIRMED",
                amount=200,
                occurred_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
                category_id="food",
                category_name="Food",
                parent_category_id=None,
                parent_category_name=None,
            ),
        ],
        now=datetime(2026, 4, 10, tzinfo=timezone.utc),
    )

    assert payload["totals"]["currentPeriod"]["income"] == 1200
    assert payload["totals"]["currentPeriod"]["expense"] == 400
    assert payload["totals"]["previousPeriod"]["expense"] == 200
    assert payload["counts"]["operations"] == 2
    assert payload["counts"]["expense"] == 1
    assert payload["topExpenseCategories"][0]["categoryName"] == "Food"
