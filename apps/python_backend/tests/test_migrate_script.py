from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "migrate.py"
SPEC = importlib.util.spec_from_file_location("denga_migrate_script", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
migrate_module = importlib.util.module_from_spec(SPEC)
sys.modules.setdefault("denga_migrate_script", migrate_module)
SPEC.loader.exec_module(migrate_module)


def test_verify_head_returns_failure_when_database_lags(monkeypatch, capsys) -> None:
    class FakeConfig:
        def get_main_option(self, name: str) -> str:
            assert name == "sqlalchemy.url"
            return "postgresql://example"

    monkeypatch.setattr(migrate_module, "_build_alembic_config", lambda: FakeConfig())

    class FakeScriptDirectory:
        def get_heads(self) -> tuple[str, ...]:
            return ("20260419_01",)

    class FakeMigrationContext:
        def get_current_heads(self) -> tuple[str, ...]:
            return ("20260414_01",)

    class FakeConnection:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    class FakeEngine:
        def connect(self) -> FakeConnection:
            return FakeConnection()

    monkeypatch.setattr(
        migrate_module.ScriptDirectory,
        "from_config",
        staticmethod(lambda config: FakeScriptDirectory()),
    )
    monkeypatch.setattr(
        migrate_module.MigrationContext,
        "configure",
        staticmethod(lambda connection: FakeMigrationContext()),
    )
    monkeypatch.setattr(migrate_module, "engine", FakeEngine())

    assert migrate_module.verify_head() == 1
    captured = capsys.readouterr()
    assert "Database schema is not at Alembic head" in captured.err
    assert "20260419_01" in captured.err
    assert "20260414_01" in captured.err


def test_verify_head_returns_success_when_database_is_current(monkeypatch, capsys) -> None:
    class FakeConfig:
        def get_main_option(self, name: str) -> str:
            assert name == "sqlalchemy.url"
            return "postgresql://example"

    monkeypatch.setattr(migrate_module, "_build_alembic_config", lambda: FakeConfig())

    class FakeScriptDirectory:
        def get_heads(self) -> tuple[str, ...]:
            return ("20260419_01",)

    class FakeMigrationContext:
        def get_current_heads(self) -> tuple[str, ...]:
            return ("20260419_01",)

    class FakeConnection:
        def __enter__(self) -> object:
            return object()

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    class FakeEngine:
        def connect(self) -> FakeConnection:
            return FakeConnection()

    monkeypatch.setattr(
        migrate_module.ScriptDirectory,
        "from_config",
        staticmethod(lambda config: FakeScriptDirectory()),
    )
    monkeypatch.setattr(
        migrate_module.MigrationContext,
        "configure",
        staticmethod(lambda connection: FakeMigrationContext()),
    )
    monkeypatch.setattr(migrate_module, "engine", FakeEngine())

    assert migrate_module.verify_head() == 0
    captured = capsys.readouterr()
    assert "Database schema is at Alembic head: 20260419_01" in captured.out
