from __future__ import annotations

from collections.abc import Generator
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api import create_app
from app.config import get_settings
from app.dependencies import get_db
from app.security import create_access_token


def _dummy_db() -> Generator[None, None, None]:
    yield None


def test_health_endpoint_is_public() -> None:
    app = create_app()
    app.dependency_overrides[get_db] = _dummy_db
    with TestClient(app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["x-request-id"]
    assert response.headers["x-correlation-id"]


def test_transactions_require_authentication() -> None:
    app = create_app()
    app.dependency_overrides[get_db] = _dummy_db
    with TestClient(app) as client:
        response = client.get("/api/transactions")
    assert response.status_code == 401
    assert response.json() == {"message": "Unauthorized"}


def test_users_endpoint_requires_admin_role() -> None:
    app = create_app()
    app.dependency_overrides[get_db] = _dummy_db
    token = create_access_token({"sub": "member-1", "email": "member@example.com", "role": "MEMBER"})
    with TestClient(app) as client:
        response = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json() == {"message": "Admin access required"}


def test_login_validation_returns_message_array() -> None:
    app = create_app()
    app.dependency_overrides[get_db] = _dummy_db
    with TestClient(app) as client:
        response = client.post("/api/auth/login", json={"email": "bad"})
    assert response.status_code == 422
    assert isinstance(response.json()["message"], list)


def test_transactions_options_supports_configured_cors_origin() -> None:
    with patch.dict(
        "os.environ",
        {
            "WEB_URL": "http://localhost:3000",
            "CORS_ALLOWED_ORIGINS": "https://admin.example.com",
        },
        clear=False,
    ):
        get_settings.cache_clear()
        app = create_app()
        app.dependency_overrides[get_db] = _dummy_db

        with TestClient(app) as client:
            response = client.options(
                "/api/transactions?status=confirmed&sortBy=occurredAt&sortDir=desc&page=1&pageSize=10",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )

    get_settings.cache_clear()

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"
