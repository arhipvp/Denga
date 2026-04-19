from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models import Base


revision = "20260414_01"
down_revision = None
branch_labels = None
depends_on = None

ENUM_TYPES = (
    postgresql.ENUM("ADMIN", "MEMBER", name="UserRole"),
    postgresql.ENUM("INCOME", "EXPENSE", name="TransactionType"),
    postgresql.ENUM("INCOME", "EXPENSE", name="CategoryType"),
    postgresql.ENUM("CONFIRMED", "NEEDS_CLARIFICATION", "CANCELLED", name="TransactionStatus"),
    postgresql.ENUM("TELEGRAM_TEXT", "TELEGRAM_RECEIPT", "ADMIN_MANUAL", name="SourceMessageType"),
    postgresql.ENUM("RECEIVED", "PENDING_REVIEW", "PARSED", "NEEDS_CLARIFICATION", "CANCELLED", "ERROR", name="SourceMessageStatus"),
    postgresql.ENUM("OPEN", "RESOLVED", "CANCELLED", "EXPIRED", name="ClarificationStatus"),
    postgresql.ENUM("INITIAL_PARSE", "CLARIFICATION_REPARSE", name="AiParseAttemptType"),
)

BASELINE_TABLE_NAMES = (
    "Household",
    "User",
    "TelegramAccount",
    "Category",
    "SourceMessage",
    "Attachment",
    "AiParseAttempt",
    "ClarificationSession",
    "PendingOperationReview",
    "Transaction",
    "AppSetting",
    "Job",
)


def _baseline_metadata() -> sa.MetaData:
    metadata = sa.MetaData()
    for table_name in BASELINE_TABLE_NAMES:
        Base.metadata.tables[table_name].to_metadata(metadata)
    return metadata


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in ENUM_TYPES:
        enum_type.create(bind, checkfirst=True)
    _baseline_metadata().create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    _baseline_metadata().drop_all(bind=bind)
    for enum_type in reversed(ENUM_TYPES):
        enum_type.drop(bind, checkfirst=True)
