from __future__ import annotations

import json
import os
import sys
from typing import Any

import httpx


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def _login(base_url: str, email: str, password: str) -> str:
    response = httpx.post(
        f"{base_url}/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("accessToken")
    if not token:
        raise SystemExit("Login succeeded but accessToken is missing")
    return str(token)


def _request(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    expected_status: int,
    json_body: dict[str, Any] | None = None,
) -> Any:
    response = client.request(method, path, json=json_body)
    if response.status_code != expected_status:
        raise AssertionError(f"{method} {path} -> {response.status_code}, expected {expected_status}: {response.text}")
    if response.headers.get("content-type", "").startswith("application/json"):
        return response.json()
    return response.text


def main() -> int:
    base_url = _require_env("VERIFY_API_BASE_URL").rstrip("/")
    admin_email = _require_env("VERIFY_ADMIN_EMAIL")
    admin_password = _require_env("VERIFY_ADMIN_PASSWORD")
    member_email = os.getenv("VERIFY_MEMBER_EMAIL")
    member_password = os.getenv("VERIFY_MEMBER_PASSWORD")

    admin_token = _login(base_url, admin_email, admin_password)
    member_token = _login(base_url, member_email, member_password) if member_email and member_password else None

    failures: list[str] = []
    results: list[dict[str, Any]] = []

    def run_check(name: str, fn) -> None:
        try:
            result = fn()
            results.append({"name": name, "status": "ok", "details": result})
        except Exception as exc:  # pragma: no cover - CLI guard
            failures.append(f"{name}: {exc}")
            results.append({"name": name, "status": "failed", "details": str(exc)})

    with httpx.Client(base_url=base_url, timeout=20) as public_client:
        run_check(
            "public-health",
            lambda: _request(public_client, "GET", "/health", expected_status=200),
        )
        run_check(
            "public-readiness",
            lambda: _request(public_client, "GET", "/health/ready", expected_status=200),
        )
        run_check(
            "unauthorized-transactions",
            lambda: _request(public_client, "GET", "/transactions", expected_status=401),
        )
        run_check(
            "validation-login",
            lambda: _request(public_client, "POST", "/auth/login", expected_status=422, json_body={"email": "bad"}),
        )

    with httpx.Client(base_url=base_url, timeout=20, headers={"Authorization": f"Bearer {admin_token}"}) as admin_client:
        run_check("auth-me", lambda: _request(admin_client, "GET", "/auth/me", expected_status=200))
        run_check("transactions-list", lambda: _request(admin_client, "GET", "/transactions?page=1&pageSize=5", expected_status=200))
        run_check("transactions-summary", lambda: _request(admin_client, "GET", "/transactions/summary", expected_status=200))
        run_check("categories-list", lambda: _request(admin_client, "GET", "/categories", expected_status=200))
        run_check("users-list", lambda: _request(admin_client, "GET", "/users", expected_status=200))
        run_check("settings-get", lambda: _request(admin_client, "GET", "/settings", expected_status=200))
        run_check("backups-latest", lambda: _request(admin_client, "GET", "/backups/latest", expected_status=200))
        run_check("logs-list", lambda: _request(admin_client, "GET", "/logs?page=1&pageSize=5", expected_status=200))
        run_check("telegram-status", lambda: _request(admin_client, "GET", "/telegram/status", expected_status=200))

    if member_token:
        with httpx.Client(base_url=base_url, timeout=20, headers={"Authorization": f"Bearer {member_token}"}) as member_client:
            run_check("member-users-forbidden", lambda: _request(member_client, "GET", "/users", expected_status=403))
    else:
        results.append(
            {
                "name": "member-users-forbidden",
                "status": "skipped",
                "details": "VERIFY_MEMBER_EMAIL / VERIFY_MEMBER_PASSWORD not provided",
            }
        )

    print(json.dumps({"results": results, "failed": failures}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
