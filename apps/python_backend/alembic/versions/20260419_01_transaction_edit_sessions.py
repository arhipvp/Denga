from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql


revision = "20260419_01"
down_revision = "20260414_01"
branch_labels = None
depends_on = None


transaction_edit_session_status = postgresql.ENUM(
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
    name="TransactionEditSessionStatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    enum_exists = bind.execute(
        sa.text("SELECT 1 FROM pg_type WHERE typname = :type_name"),
        {"type_name": "TransactionEditSessionStatus"},
    ).scalar_one_or_none()
    if not enum_exists:
        transaction_edit_session_status.create(bind, checkfirst=True)
    if inspector.has_table("TransactionEditSession"):
        return
    op.create_table(
        "TransactionEditSession",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("authorId", sa.String(), nullable=True),
        sa.Column("transactionId", sa.String(), nullable=False),
        sa.Column("status", transaction_edit_session_status, nullable=False),
        sa.Column("draft", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("pendingField", sa.String(), nullable=True),
        sa.Column("lastBotMessageId", sa.String(), nullable=True),
        sa.Column("activePickerMessageId", sa.String(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=False), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=False), nullable=False),
        sa.ForeignKeyConstraint(["authorId"], ["User.id"], ondelete="SET NULL", onupdate="CASCADE"),
        sa.ForeignKeyConstraint(["transactionId"], ["Transaction.id"], ondelete="CASCADE", onupdate="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if inspector.has_table("TransactionEditSession"):
        op.drop_table("TransactionEditSession")
    transaction_edit_session_status.drop(bind, checkfirst=True)
