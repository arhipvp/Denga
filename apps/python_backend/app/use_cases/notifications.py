from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.domain.job_policy import build_job_dedupe_key
from app.logging_utils import logger
from app.models import TransactionType
from app.observability import increment_metric
from app.repositories.transaction_repository import TransactionRepository
from app.services_core import bootstrap_household_id
from app.telegram_adapter import TelegramAdapter
from app.use_cases.jobs import enqueue_use_case_job


JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS = "send_transaction_notifications"


def enqueue_notification_job(
    db: Session,
    transaction_id: str,
    event: str,
    exclude_telegram_ids: list[str] | None = None,
) -> None:
    payload = {"transactionId": transaction_id, "event": event, "excludeTelegramIds": exclude_telegram_ids or []}
    enqueue_use_case_job(
        db,
        job_type=JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS,
        payload=payload,
        household_id=bootstrap_household_id(),
        dedupe_key=build_job_dedupe_key(JOB_TYPE_SEND_TRANSACTION_NOTIFICATIONS, payload),
    )


def notify_transaction_event(db: Session, payload: dict[str, Any], telegram: TelegramAdapter) -> dict[str, Any]:
    transaction = TransactionRepository(db).get_for_notification(payload["transactionId"])
    if not transaction:
        return {"recipients": 0, "delivered": 0, "failed": 0}
    recipient_ids = TransactionRepository(db).list_notification_recipient_ids(
        excluded=payload.get("excludeTelegramIds") or []
    )
    if not recipient_ids:
        return {"recipients": 0, "delivered": 0, "failed": 0}
    event = payload.get("event") or "created"
    type_label = "Доход" if transaction.type == TransactionType.INCOME else "Расход"
    category_name = (
        f"{transaction.category.parent.name} / {transaction.category.name}"
        if transaction.category and transaction.category.parent
        else (transaction.category.name if transaction.category else "Не указана")
    )
    message = "\n".join(
        [
            "Добавлена новая операция" if event == "created" else "Операция удалена",
            "",
            f"Тип: {type_label}",
            f"Сумма: {float(transaction.amount):.2f} {transaction.currency}",
            f"Дата: {transaction.occurred_at.strftime('%d.%m.%Y')}",
            f"Категория: {category_name}",
            f"Комментарий: {transaction.comment or 'Не указан'}",
            *([f"Автор: {transaction.author.display_name}"] if transaction.author else []),
        ]
    )
    delivered = 0
    failed = 0
    for chat_id in recipient_ids:
        try:
            telegram.send_message(chat_id, message)
            delivered += 1
        except Exception as exc:
            failed += 1
            logger.error(
                "telegram",
                "transaction_notification_failed",
                "Transaction notification failed",
                {"transactionId": transaction.id, "chatId": chat_id, "error": exc},
            )
    increment_metric("notifications.sent")
    return {"recipients": len(recipient_ids), "delivered": delivered, "failed": failed}
