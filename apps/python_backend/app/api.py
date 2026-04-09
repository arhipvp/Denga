from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.dependencies import AdminUser, CurrentUser, DbSession
from app.schemas import (
    CategoryUpdateRequest,
    CategoryWriteRequest,
    ChangePasswordRequest,
    LoginRequest,
    SettingsUpdateRequest,
    TelegramWebhookRequest,
    TransactionCreateRequest,
    TransactionUpdateRequest,
    UserRenameRequest,
)
from app.services_core import (
    change_password,
    create_category,
    disable_category,
    get_settings_payload,
    list_categories,
    list_users,
    login,
    rename_user,
    update_category,
    update_settings_payload,
)
from app.services_runtime import (
    cancel_transaction,
    create_backup,
    create_transaction,
    enqueue_telegram_update,
    get_health,
    get_latest_backup,
    get_readiness,
    get_telegram_status,
    list_transactions,
    open_latest_backup,
    read_logs,
    transaction_summary,
    update_transaction,
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    if settings.allowed_cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=settings.upload_path), name="uploads")

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}
        return JSONResponse(status_code=exc.status_code, content=detail)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"message": [error["msg"] for error in exc.errors()]},
        )

    prefix = settings.api_prefix

    @app.post(f"{prefix}/auth/login")
    def auth_login(payload: LoginRequest, db: DbSession) -> dict:
        return login(db, payload.email, payload.password)

    @app.post(f"{prefix}/auth/change-password")
    def auth_change_password(payload: ChangePasswordRequest, db: DbSession, user: CurrentUser) -> dict:
        return change_password(db, user["sub"], payload.currentPassword, payload.newPassword)

    @app.get(f"{prefix}/auth/me")
    def auth_me(user: CurrentUser) -> dict:
        return user

    @app.get(f"{prefix}/health")
    def health() -> dict:
        return get_health()

    @app.get(f"{prefix}/health/ready")
    def readiness(db: DbSession) -> dict:
        readiness_payload = get_readiness(db)
        if readiness_payload["status"] != "ok":
            raise HTTPException(status_code=503, detail=readiness_payload)
        return readiness_payload

    @app.get(f"{prefix}/categories")
    def categories_list(_: CurrentUser, db: DbSession) -> list[dict]:
        return list_categories(db)

    @app.post(f"{prefix}/categories")
    def categories_create(payload: CategoryWriteRequest, _: CurrentUser, db: DbSession) -> dict:
        return create_category(db, payload)

    @app.patch(f"{prefix}/categories/{{category_id}}")
    def categories_update(category_id: str, payload: CategoryUpdateRequest, _: CurrentUser, db: DbSession) -> dict:
        return update_category(db, category_id, payload)

    @app.delete(f"{prefix}/categories/{{category_id}}")
    def categories_delete(category_id: str, _: CurrentUser, db: DbSession) -> dict:
        return disable_category(db, category_id)

    @app.get(f"{prefix}/transactions")
    def transactions_list(
        _: CurrentUser,
        db: DbSession,
        status: str | None = None,
        type: str | None = Query(default=None, alias="type"),
        search: str | None = None,
        sortBy: str | None = None,
        sortDir: str | None = None,
        page: int | None = None,
        pageSize: int | None = None,
    ) -> dict:
        return list_transactions(
            db,
            status=status,
            type_=type,
            search=search,
            sort_by=sortBy,
            sort_dir=sortDir,
            page=page,
            page_size=pageSize,
        )

    @app.get(f"{prefix}/transactions/summary")
    def transactions_summary(_: CurrentUser, db: DbSession) -> dict:
        return transaction_summary(db)

    @app.post(f"{prefix}/transactions")
    def transactions_create(payload: TransactionCreateRequest, user: CurrentUser, db: DbSession) -> dict:
        return create_transaction(db, payload, user["sub"])

    @app.patch(f"{prefix}/transactions/{{transaction_id}}")
    def transactions_update(transaction_id: str, payload: TransactionUpdateRequest, _: CurrentUser, db: DbSession) -> dict:
        return update_transaction(db, transaction_id, payload)

    @app.delete(f"{prefix}/transactions/{{transaction_id}}")
    def transactions_delete(transaction_id: str, _: CurrentUser, db: DbSession) -> dict:
        return cancel_transaction(db, transaction_id)

    @app.get(f"{prefix}/users")
    def users_list(_: AdminUser, db: DbSession) -> list[dict]:
        return list_users(db)

    @app.patch(f"{prefix}/users/{{user_id}}")
    def users_update(user_id: str, payload: UserRenameRequest, _: AdminUser, db: DbSession) -> dict:
        return rename_user(db, user_id, payload)

    @app.get(f"{prefix}/settings")
    def settings_get(_: CurrentUser, db: DbSession) -> dict:
        return get_settings_payload(db)

    @app.put(f"{prefix}/settings")
    def settings_update(payload: SettingsUpdateRequest, _: CurrentUser, db: DbSession) -> dict:
        return update_settings_payload(db, payload)

    @app.post(f"{prefix}/backups")
    def backups_create(user: AdminUser) -> dict:
        return create_backup(user)

    @app.get(f"{prefix}/backups/latest")
    def backups_latest(_: AdminUser) -> dict | None:
        return get_latest_backup()

    @app.get(f"{prefix}/backups/latest/download")
    def backups_download(user: AdminUser) -> FileResponse:
        path = open_latest_backup(user)
        return FileResponse(path, filename=path.name, media_type="application/octet-stream")

    @app.get(f"{prefix}/logs")
    def logs_list(
        user: AdminUser,
        level: str | None = None,
        source: str | None = None,
        search: str | None = None,
        sortBy: str | None = None,
        sortDir: str | None = None,
        page: int | None = None,
        pageSize: int | None = None,
    ) -> dict:
        return read_logs(
            user,
            level=level,
            source=source,
            search=search,
            sort_by=sortBy,
            sort_dir=sortDir,
            page=page,
            page_size=pageSize,
        )

    @app.get(f"{prefix}/telegram/status")
    def telegram_status(_: CurrentUser) -> dict:
        return get_telegram_status()

    @app.post(f"{prefix}/telegram/webhook")
    def telegram_webhook(payload: TelegramWebhookRequest, db: DbSession) -> dict:
        return enqueue_telegram_update(db, payload.model_dump())

    return app
