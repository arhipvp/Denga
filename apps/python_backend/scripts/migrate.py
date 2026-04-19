from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlsplit

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import engine, normalize_sqlalchemy_database_url
from app.models import Base


BASE_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BASE_DIR / "alembic.ini"
BASELINE_REVISION = "20260414_01"


def _build_alembic_config() -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(BASE_DIR / "alembic"))
    config.set_main_option(
        "sqlalchemy.url",
        normalize_sqlalchemy_database_url(engine.url.render_as_string(hide_password=False)),
    )
    return config


def _database_has_application_tables() -> bool:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    app_table_names = set(Base.metadata.tables)
    return bool(table_names & app_table_names)


def _alembic_version_exists() -> bool:
    inspector = inspect(engine)
    return inspector.has_table("alembic_version")


def _print_database_connection_hint(database_url: str) -> None:
    parts = urlsplit(database_url)
    host = parts.hostname or "unknown"
    port = parts.port or "default"
    print(
        f"Database connection failed for {host}:{port}. "
        "Ensure PostgreSQL is running and ready before executing migrations.",
        file=sys.stderr,
    )


def upgrade() -> int:
    config = _build_alembic_config()
    database_url = config.get_main_option("sqlalchemy.url")
    try:
        if not _alembic_version_exists() and _database_has_application_tables():
            command.stamp(config, BASELINE_REVISION)
        command.upgrade(config, "head")
    except OperationalError as exc:
        _print_database_connection_hint(database_url)
        raise
    return 0


def current() -> int:
    command.current(_build_alembic_config())
    return 0


def verify_head() -> int:
    config = _build_alembic_config()
    database_url = config.get_main_option("sqlalchemy.url")
    try:
        expected_heads = tuple(ScriptDirectory.from_config(config).get_heads())
        with engine.connect() as connection:
            current_heads = tuple(MigrationContext.configure(connection).get_current_heads())
    except OperationalError:
        _print_database_connection_hint(database_url)
        raise

    if set(current_heads) != set(expected_heads):
        expected_display = ", ".join(expected_heads) if expected_heads else "<none>"
        current_display = ", ".join(current_heads) if current_heads else "<none>"
        print(
            "Database schema is not at Alembic head. "
            f"Expected: {expected_display}. Current: {current_display}.",
            file=sys.stderr,
        )
        return 1

    print(f"Database schema is at Alembic head: {', '.join(expected_heads)}")
    return 0


def stamp_baseline() -> int:
    command.stamp(_build_alembic_config(), BASELINE_REVISION)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run database migrations for the Python backend.")
    parser.add_argument("command", choices=("upgrade", "current", "verify-head", "stamp-baseline"))
    args = parser.parse_args()

    if args.command == "upgrade":
        return upgrade()
    if args.command == "current":
        return current()
    if args.command == "verify-head":
        return verify_head()
    return stamp_baseline()


if __name__ == "__main__":
    raise SystemExit(main())
