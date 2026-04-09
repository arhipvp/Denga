from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text

from app.database import SessionLocal


def _to_float(value: Decimal | float | int | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def _fetch_all(query: str, **params: Any) -> list[dict[str, Any]]:
    with SessionLocal() as session:
        rows = session.execute(text(query), params)
        return [dict(row._mapping) for row in rows]


def build_snapshot() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    snapshot = {
        "generatedAt": now.isoformat(),
        "transactionCount": _fetch_all('SELECT COUNT(*) AS value FROM "Transaction"')[0]["value"],
        "categoryCount": _fetch_all('SELECT COUNT(*) AS value FROM "Category"')[0]["value"],
        "transactionStatusCounts": _fetch_all(
            'SELECT status, COUNT(*) AS count FROM "Transaction" GROUP BY status ORDER BY status'
        ),
        "activeLeafCategoryCount": _fetch_all(
            '''
            SELECT COUNT(*) AS value
            FROM "Category" c
            WHERE c."isActive" = true
              AND NOT EXISTS (SELECT 1 FROM "Category" child WHERE child."parentId" = c.id)
            '''
        )[0]["value"],
        "monthlyTotals": _fetch_all(
            '''
            SELECT
              to_char(date_trunc('month', "occurredAt"), 'YYYY-MM') AS month,
              type,
              COALESCE(SUM(amount), 0) AS total
            FROM "Transaction"
            WHERE status = 'CONFIRMED'
            GROUP BY 1, 2
            ORDER BY 1 DESC, 2 ASC
            LIMIT 12
            '''
        ),
        "sampleRecentTransactions": _fetch_all(
            '''
            SELECT
              t.id,
              t.type,
              t.status,
              t.amount,
              t."occurredAt",
              c.name AS "categoryName",
              parent.name AS "parentCategoryName"
            FROM "Transaction" t
            LEFT JOIN "Category" c ON c.id = t."categoryId"
            LEFT JOIN "Category" parent ON parent.id = c."parentId"
            ORDER BY t."occurredAt" DESC
            LIMIT 10
            '''
        ),
        "sampleCategoryPaths": _fetch_all(
            '''
            SELECT
              c.id,
              c.type,
              c."isActive",
              c.name,
              parent.name AS "parentName",
              CASE
                WHEN parent.id IS NULL THEN c.name
                ELSE parent.name || ' / ' || c.name
              END AS "displayPath"
            FROM "Category" c
            LEFT JOIN "Category" parent ON parent.id = c."parentId"
            ORDER BY parent.name NULLS FIRST, c.name
            LIMIT 20
            '''
        ),
    }

    for item in snapshot["monthlyTotals"]:
        item["total"] = _to_float(item["total"])
    for item in snapshot["sampleRecentTransactions"]:
        item["amount"] = _to_float(item["amount"])
        occurred_at = item.get("occurredAt")
        if hasattr(occurred_at, "isoformat"):
            item["occurredAt"] = occurred_at.isoformat()
    return snapshot


def _strip_volatile(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in snapshot.items() if key != "generatedAt"}


def _compare_sequences(left: Sequence[Any], right: Sequence[Any], *, path: str) -> list[str]:
    mismatches: list[str] = []
    if len(left) != len(right):
        mismatches.append(f"{path}: length {len(left)} != {len(right)}")
        return mismatches
    for index, (left_value, right_value) in enumerate(zip(left, right, strict=False)):
        mismatches.extend(_compare_values(left_value, right_value, path=f"{path}[{index}]"))
    return mismatches


def _compare_values(left: Any, right: Any, *, path: str) -> list[str]:
    if isinstance(left, dict) and isinstance(right, dict):
        mismatches: list[str] = []
        for key in sorted(set(left) | set(right)):
            if key not in left or key not in right:
                mismatches.append(f"{path}.{key}: missing key")
                continue
            mismatches.extend(_compare_values(left[key], right[key], path=f"{path}.{key}"))
        return mismatches
    if isinstance(left, list) and isinstance(right, list):
        return _compare_sequences(left, right, path=path)
    if left != right:
        return [f"{path}: {left!r} != {right!r}"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="Build or compare cutover safety snapshots for Transaction/Category data.")
    parser.add_argument("--write", type=Path, help="Write the current snapshot to this JSON file.")
    parser.add_argument("--compare", type=Path, help="Compare the current snapshot with this JSON baseline.")
    args = parser.parse_args()

    snapshot = build_snapshot()
    if args.write:
        args.write.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote snapshot to {args.write}")

    if args.compare:
        baseline = json.loads(args.compare.read_text(encoding="utf-8"))
        mismatches = _compare_values(_strip_volatile(baseline), _strip_volatile(snapshot), path="snapshot")
        if mismatches:
            print(json.dumps({"status": "mismatch", "mismatches": mismatches}, ensure_ascii=False, indent=2))
            return 1
        print(json.dumps({"status": "ok", "comparedTo": str(args.compare)}, ensure_ascii=False, indent=2))
        return 0

    if not args.write:
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
