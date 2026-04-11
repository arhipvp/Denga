from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "app"


def _imports_for(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
    return imports


def test_domain_modules_do_not_import_framework_or_db_layers() -> None:
    forbidden = ("sqlalchemy", "fastapi", "app.telegram_adapter", "app.repositories")
    for path in (ROOT / "domain").glob("*.py"):
        imports = _imports_for(path)
        assert all(not item.startswith(forbidden) for item in imports), f"{path.name} imports forbidden modules: {imports}"


def test_use_cases_do_not_import_fastapi() -> None:
    for path in (ROOT / "use_cases").glob("*.py"):
        imports = _imports_for(path)
        assert all(not item.startswith("fastapi") for item in imports), f"{path.name} imports fastapi: {imports}"


def test_repositories_do_not_import_transport_layer() -> None:
    forbidden = ("app.api", "app.worker", "app.telegram_adapter")
    for path in (ROOT / "repositories").glob("*.py"):
        imports = _imports_for(path)
        assert all(not item.startswith(forbidden) for item in imports), f"{path.name} imports transport layer: {imports}"
