from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from app.models import Base


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260414_01_baseline_schema.py"
SPEC = importlib.util.spec_from_file_location("denga_alembic_baseline", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
baseline_module = importlib.util.module_from_spec(SPEC)
sys.modules.setdefault("denga_alembic_baseline", baseline_module)
SPEC.loader.exec_module(baseline_module)


def test_baseline_metadata_does_not_include_future_transaction_edit_session_table() -> None:
    metadata = baseline_module._baseline_metadata()

    assert "TransactionEditSession" not in metadata.tables
    assert "Job" in metadata.tables
    assert set(metadata.tables).issubset(set(Base.metadata.tables))
