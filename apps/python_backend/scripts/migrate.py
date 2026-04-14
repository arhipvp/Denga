from __future__ import annotations

import argparse
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

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


def upgrade() -> int:
    config = _build_alembic_config()
    if not _alembic_version_exists() and _database_has_application_tables():
        command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, "head")
    return 0


def current() -> int:
    command.current(_build_alembic_config())
    return 0


def stamp_baseline() -> int:
    command.stamp(_build_alembic_config(), BASELINE_REVISION)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run database migrations for the Python backend.")
    parser.add_argument("command", choices=("upgrade", "current", "stamp-baseline"))
    args = parser.parse_args()

    if args.command == "upgrade":
        return upgrade()
    if args.command == "current":
        return current()
    return stamp_baseline()


if __name__ == "__main__":
    raise SystemExit(main())
