from __future__ import annotations

import json
import math
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.config import Settings, get_settings
from app.jobs import enqueue_job
from app.logging_utils import logger
from app.models import Category, SourceMessage, SourceMessageStatus, SourceMessageType, Transaction, TransactionStatus, TransactionType, User
from app.schemas import TransactionCreateRequest, TransactionUpdateRequest
from app.services_core import bootstrap_household_id, get_settings_payload, map_category_type, require_entity
from app.summary import SummaryTransaction, calculate_transaction_summary

PG_DUMP_ALLOWED_QUERY_PARAMS = {
    "application_name", "channel_binding", "client_encoding", "connect_timeout", "gssencmode",
    "hostaddr", "keepalives", "keepalives_count", "keepalives_idle", "keepalives_interval",
    "krbsrvname", "options", "passfile", "requiressl", "requirepeer", "service", "sslcert",
    "sslcompression", "sslcrl", "sslcrldir", "sslkey", "ssl_max_protocol_version",
    "ssl_min_protocol_version", "sslmode", "sslnegotiation", "sslpassword", "sslrootcert",
    "sslsni", "target_session_attrs", "tcp_user_timeout",
}

BACKUP_TABLES = [
    'public."Household"',
    'public."User"',
    'public."Category"',
    'public."Transaction"',
    'public."AppSetting"',
]


def _map_status(value: str | None) -> TransactionStatus | None:
    if value == "confirmed":
        return TransactionStatus.CONFIRMED
    if value == "needs_clarification":
        return TransactionStatus.NEEDS_CLARIFICATION
    if value == "cancelled":
        return TransactionStatus.CANCELLED
    return None


def _map_type(value: str | None) -> TransactionType | None:
    if value == "income":
        return TransactionType.INCOME
    if value == "expense":
        return TransactionType.EXPENSE
    return None


def _ensure_category_type(db: Session, category_id: str, transaction_type: str) -> Category:
    category = db.execute(select(Category).where(Category.id == category_id)).scalar_one_or_none()
    if not category or category.household_id != bootstrap_household_id():
        raise HTTPException(status_code=404, detail="Category not found")
    if category.type != map_category_type(transaction_type):
        raise HTTPException(status_code=400, detail="Category type must match transaction type")
    return category


def _transaction_query() -> Any:
    return (
        select(Transaction)
        .options(
            joinedload(Transaction.category).joinedload(Category.parent),
            joinedload(Transaction.author),
            joinedload(Transaction.source_message).joinedload(SourceMessage.clarification_session),
            joinedload(Transaction.source_message).joinedload(SourceMessage.review_draft),
        )
    )


def _category_display(category: Category | None) -> dict[str, Any] | None:
    if not category:
        return None
    parent = None
    if category.parent:
        parent = {
            "id": category.parent.id,
            "parentId": category.parent.parent_id,
            "name": category.parent.name,
            "type": category.parent.type.value,
            "isActive": category.parent.is_active,
            "displayPath": category.parent.name,
            "isLeaf": False,
            "children": [],
        }
    return {
        "id": category.id,
        "parentId": category.parent_id,
        "name": category.name,
        "type": category.type.value,
        "isActive": category.is_active,
        "isLeaf": category.parent_id is not None,
        "displayPath": f"{category.parent.name} / {category.name}" if category.parent else category.name,
        "children": [],
        "parent": parent,
        "createdAt": category.created_at.isoformat(),
        "updatedAt": category.updated_at.isoformat(),
    }


def _serialize_source_message(message: SourceMessage | None) -> dict[str, Any] | None:
    if not message:
        return None
    attachments = [{"id": item.id, "localPath": item.local_path} for item in getattr(message, "attachments", [])]
    parse_attempts = [
        {
            "id": item.id,
            "attemptType": item.attempt_type.value,
            "model": item.model,
            "responsePayload": item.response_payload,
        }
        for item in getattr(message, "parse_attempts", [])
    ]
    clarification = message.clarification_session
    review_draft = message.review_draft
    return {
        "type": message.type.value,
        "text": message.text,
        "attachments": attachments,
        "parseAttempts": parse_attempts,
        "clarificationSession": (
            {
                "question": clarification.question,
                "status": clarification.status.value,
                "conversation": clarification.conversation,
            }
            if clarification
            else None
        ),
        "reviewDraft": (
            {
                "status": review_draft.status.value,
                "pendingField": review_draft.pending_field,
                "draft": review_draft.draft,
            }
            if review_draft
            else None
        ),
    }


def _serialize_transaction(item: Transaction) -> dict[str, Any]:
    return {
        "id": item.id,
        "type": item.type.value,
        "amount": f"{float(item.amount):.2f}",
        "currency": item.currency,
        "occurredAt": item.occurred_at.isoformat(),
        "comment": item.comment,
        "status": item.status.value,
        "category": _category_display(item.category),
        "author": {"displayName": item.author.display_name} if item.author else None,
        "sourceMessage": _serialize_source_message(item.source_message),
        "createdAt": item.created_at.isoformat(),
        "updatedAt": item.updated_at.isoformat(),
        "categoryId": item.category_id,
    }


def list_transactions(
    db: Session,
    *,
    status: str | None,
    type_: str | None,
    search: str | None,
    sort_by: str | None,
    sort_dir: str | None,
    page: int | None,
    page_size: int | None,
) -> dict[str, Any]:
    page = 1 if not page or page < 1 else math.floor(page)
    page_size = 20 if not page_size or page_size < 1 else min(math.floor(page_size), 100)
    query = _transaction_query().where(Transaction.household_id == bootstrap_household_id())
    count_query = select(func.count()).select_from(Transaction).where(Transaction.household_id == bootstrap_household_id())
    mapped_status = _map_status(status)
    mapped_type = _map_type(type_)
    if mapped_status:
        query = query.where(Transaction.status == mapped_status)
        count_query = count_query.where(Transaction.status == mapped_status)
    if mapped_type:
        query = query.where(Transaction.type == mapped_type)
        count_query = count_query.where(Transaction.type == mapped_type)
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        search_clause = or_(
            func.lower(func.coalesce(Transaction.comment, "")).like(term),
            Transaction.category.has(func.lower(Category.name).like(term)),
            Transaction.author.has(func.lower(User.display_name).like(term)),
            Transaction.source_message.has(func.lower(func.coalesce(SourceMessage.text, "")).like(term)),
        )
        query = query.where(search_clause)
        count_query = count_query.where(search_clause)

    direction = "asc" if sort_dir == "asc" else "desc"
    if sort_by == "amount":
        query = query.order_by(text(f'"amount" {direction}'), Transaction.occurred_at.desc())
    elif sort_by == "type":
        query = query.order_by(text(f'"type" {direction}'), Transaction.occurred_at.desc())
    elif sort_by == "status":
        query = query.order_by(text(f'"status" {direction}'), Transaction.occurred_at.desc())
    elif sort_by == "createdAt":
        query = query.order_by(text(f'"createdAt" {direction}'), Transaction.occurred_at.desc())
    else:
        query = query.order_by(Transaction.occurred_at.desc())

    total = db.execute(count_query).scalar_one()
    items = db.execute(query.offset((page - 1) * page_size).limit(page_size)).unique().scalars()
    return {"items": [_serialize_transaction(item) for item in items], "total": total, "page": page, "pageSize": page_size}


def transaction_summary(db: Session) -> dict[str, Any]:
    transactions = list(
        db.execute(
            _transaction_query().where(Transaction.household_id == bootstrap_household_id()).order_by(Transaction.occurred_at.asc())
        ).unique().scalars()
    )
    recent = sorted(transactions, key=lambda item: item.occurred_at, reverse=True)[:8]
    summary_transactions = [
        SummaryTransaction(
            id=item.id,
            type=item.type.value,
            status=item.status.value,
            amount=float(item.amount),
            occurred_at=item.occurred_at.replace(tzinfo=timezone.utc),
            category_id=item.category_id,
            category_name=item.category.name if item.category else None,
            parent_category_id=item.category.parent.id if item.category and item.category.parent else None,
            parent_category_name=item.category.parent.name if item.category and item.category.parent else None,
        )
        for item in transactions
    ]
    payload = calculate_transaction_summary(summary_transactions)
    payload["recent"] = [_serialize_transaction(item) for item in recent]
    return payload


def create_transaction(db: Session, payload: TransactionCreateRequest, author_id: str | None) -> dict[str, Any]:
    _ensure_category_type(db, payload.categoryId, payload.type)
    settings_payload = get_settings_payload(db)
    source_message = SourceMessage(
        household_id=bootstrap_household_id(),
        author_id=author_id,
        type=SourceMessageType.ADMIN_MANUAL,
        status=SourceMessageStatus.PARSED,
        raw_payload={},
    )
    db.add(source_message)
    db.flush()
    transaction = Transaction(
        household_id=bootstrap_household_id(),
        author_id=author_id,
        source_message_id=source_message.id,
        type=_map_type(payload.type) or TransactionType.EXPENSE,
        amount=payload.amount,
        currency=settings_payload["defaultCurrency"],
        occurred_at=payload.occurredAt.replace(tzinfo=None),
        comment=payload.comment,
        category_id=payload.categoryId,
        status=TransactionStatus.CONFIRMED,
    )
    db.add(transaction)
    db.commit()
    transaction = db.execute(_transaction_query().where(Transaction.id == transaction.id)).unique().scalar_one()
    return _serialize_transaction(transaction)


def update_transaction(db: Session, transaction_id: str, payload: TransactionUpdateRequest) -> dict[str, Any]:
    transaction = require_entity(db.execute(select(Transaction).where(Transaction.id == transaction_id)).scalar_one_or_none(), "Transaction not found")
    final_type = payload.type or ("income" if transaction.type == TransactionType.INCOME else "expense")
    final_category_id = payload.categoryId or transaction.category_id
    if final_category_id:
        _ensure_category_type(db, final_category_id, final_type)
    if payload.type is not None:
        transaction.type = _map_type(payload.type) or transaction.type
    if payload.amount is not None:
        transaction.amount = payload.amount
    if payload.occurredAt is not None:
        transaction.occurred_at = payload.occurredAt.replace(tzinfo=None)
    if payload.categoryId is not None:
        transaction.category_id = payload.categoryId
    if payload.comment is not None:
        transaction.comment = payload.comment
    if payload.status is not None:
        mapped_status = _map_status(payload.status)
        if mapped_status:
            transaction.status = mapped_status
    db.commit()
    transaction = db.execute(_transaction_query().where(Transaction.id == transaction_id)).unique().scalar_one()
    return _serialize_transaction(transaction)


def cancel_transaction(db: Session, transaction_id: str) -> dict[str, bool]:
    transaction = require_entity(db.execute(select(Transaction).where(Transaction.id == transaction_id)).scalar_one_or_none(), "Transaction not found")
    transaction.status = TransactionStatus.CANCELLED
    db.commit()
    return {"success": True}


def get_telegram_status(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return {"mode": settings.telegram_mode, "botConfigured": bool(settings.telegram_bot_token), "webhookUrl": settings.telegram_webhook_url}


def get_health() -> dict[str, Any]:
    return {"status": "ok", "telegram": get_telegram_status()}


def get_readiness(db: Session, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    errors: list[str] = []
    warnings: list[str] = []
    database_ready = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        database_ready = False
        errors.append("Database connection failed.")
    storage_ready = True
    for path in (settings.upload_path, settings.backup_path, settings.log_path):
        path.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            storage_ready = False
    if not settings.polza_api_key:
        warnings.append("AI provider is not configured; receipt parsing works in fallback mode only.")
    return {"status": "ok" if not errors else "degraded", "checks": {"databaseReady": database_ready, "storageReady": storage_ready, "telegramConfigured": bool(settings.telegram_bot_token), "telegramMode": settings.telegram_mode, "aiConfigured": bool(settings.polza_api_key)}, "errors": errors, "warnings": warnings}


def _normalize_pg_dump_database_url(database_url: str) -> str:
    parsed = urlparse(database_url)
    filtered_params = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.lower() in PG_DUMP_ALLOWED_QUERY_PARAMS]
    return urlunparse(parsed._replace(query=urlencode(filtered_params)))


def _build_backup_info(file_path: Path) -> dict[str, Any]:
    stat = file_path.stat()
    return {"id": file_path.name, "fileName": file_path.name, "sizeBytes": stat.st_size, "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()}


def _list_backup_paths(settings: Settings) -> list[Path]:
    settings.backup_path.mkdir(parents=True, exist_ok=True)
    return sorted([item for item in settings.backup_path.glob("denga-ops-*.dump") if item.is_file()], key=lambda item: item.stat().st_mtime, reverse=True)


def get_latest_backup(settings: Settings | None = None) -> dict[str, Any] | None:
    settings = settings or get_settings()
    backups = _list_backup_paths(settings)
    return _build_backup_info(backups[0]) if backups else None


def create_backup(actor: dict[str, str], settings: Settings | None = None) -> dict[str, Any]:
    if actor.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = settings or get_settings()
    settings.backup_path.mkdir(parents=True, exist_ok=True)
    file_name = f"denga-ops-{datetime.now(timezone.utc).isoformat().replace(':', '-')}.dump"
    file_path = settings.backup_path / file_name
    database_url = os.environ.get("DATABASE_URL", settings.database_url)
    command = ["pg_dump", "--format=custom", f"--file={file_path}", f"--dbname={_normalize_pg_dump_database_url(database_url)}", *[f"--table={table}" for table in BACKUP_TABLES]]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        logger.error("backup", "backup_create_failed", "Backup creation failed", {"stderr": exc.stderr})
        raise HTTPException(status_code=500, detail="Backup creation failed") from exc
    for stale in _list_backup_paths(settings)[settings.backup_keep_count:]:
        stale.unlink(missing_ok=True)
    payload = _build_backup_info(file_path)
    logger.info("backup", "backup_created", "Backup created", payload)
    return payload


def open_latest_backup(actor: dict[str, str], settings: Settings | None = None) -> Path:
    if actor.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = settings or get_settings()
    backups = _list_backup_paths(settings)
    if not backups:
        raise HTTPException(status_code=404, detail="Backup not found")
    return backups[0]


def read_logs(actor: dict[str, str], *, level: str | None, source: str | None, search: str | None, sort_by: str | None, sort_dir: str | None, page: int | None, page_size: int | None) -> dict[str, Any]:
    if actor.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    log_file = logger.read_log_file()
    page = 1 if not page or page < 1 else math.floor(page)
    page_size = 20 if not page_size or page_size < 1 else min(math.floor(page_size), 100)
    if not log_file.exists():
        return {"items": [], "total": 0, "page": page, "pageSize": page_size}
    rows: list[dict[str, Any]] = []
    for line in log_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    term = search.strip().lower() if search else None
    filtered = []
    for entry in rows:
        if level and entry.get("level") != level:
            continue
        if source and entry.get("source") != source:
            continue
        if term:
            haystack = f'{entry.get("source","")} {entry.get("event","")} {entry.get("message","")}'.lower()
            if term not in haystack:
                continue
        filtered.append(entry)
    field = sort_by if sort_by in {"timestamp", "level", "source", "event"} else "timestamp"
    filtered.sort(key=lambda item: item.get(field) or "", reverse=sort_dir != "asc")
    start = (page - 1) * page_size
    return {"items": filtered[start:start + page_size], "total": len(filtered), "page": page, "pageSize": page_size}


def enqueue_telegram_update(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    job = enqueue_job(db, job_type="telegram_update", payload=payload, household_id=bootstrap_household_id())
    logger.info("telegram", "telegram_update_enqueued", "Telegram update enqueued", {"jobId": job.id})
    return {"accepted": True, "jobId": job.id}
