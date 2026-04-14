from sqlalchemy import create_engine
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import workflows
from app.database import Base
from app.models import (
    Category,
    CategoryType,
    Household,
    PendingOperationReview,
    SourceMessage,
    SourceMessageStatus,
    SourceMessageType,
    TelegramAccount,
    User,
    UserRole,
)
from app.services_core import bootstrap_household_id


class FakeTelegram:
    def __init__(self, *, edit_result: bool = False) -> None:
        self.edits: list[tuple[str, int, str, dict | None]] = []
        self.cleared_keyboards: list[tuple[str, int]] = []
        self.deleted_messages: list[tuple[str, int]] = []
        self.sent_messages: list[tuple[str, str, dict | None]] = []
        self.callback_answers: list[tuple[str, str | None]] = []
        self.edit_result = edit_result

    def edit_message(self, chat_id: str, message_id: int, text: str, reply_markup: dict | None = None) -> bool:
        self.edits.append((chat_id, message_id, text, reply_markup))
        return self.edit_result

    def clear_inline_keyboard(self, chat_id: str, message_id: int) -> bool:
        self.cleared_keyboards.append((chat_id, message_id))
        return True

    def delete_message(self, chat_id: str, message_id: int) -> bool:
        self.deleted_messages.append((chat_id, message_id))
        return True

    def send_message(self, chat_id: str, text: str, reply_markup: dict | None = None) -> dict:
        self.sent_messages.append((chat_id, text, reply_markup))
        return {"message_id": 200}

    def answer_callback_query(self, callback_query_id: str, text: str | None = None) -> None:
        self.callback_answers.append((callback_query_id, text))


def test_confirm_draft_clears_old_keyboard_when_final_edit_fails(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(
            id="parent-1",
            household_id=household_id,
            parent_id=None,
            name="Еда",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category = Category(
            id="cat-1",
            household_id=household_id,
            parent_id=parent.id,
            name="Кафе",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        db.add_all([parent, category])
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.PENDING_REVIEW,
            text="Кафе 5 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft={
                "type": "expense",
                "amount": 5.0,
                "occurredAt": "2026-04-10",
                "categoryId": category.id,
                "categoryName": "Еда / Кафе",
                "comment": "Кафе",
                "currency": "EUR",
                "confidence": 1,
                "ambiguities": [],
                "followUpQuestion": None,
                "sourceText": "Кафе 5 EUR",
            },
            pending_field=None,
            last_bot_message_id="100",
            active_picker_message_id=None,
        )
        db.add_all([source, review])
        db.commit()

        monkeypatch.setattr(workflows, "enqueue_notification_job", lambda *args, **kwargs: None)
        telegram = FakeTelegram(edit_result=False)

        result = workflows.confirm_draft(db, review.id, "42", "100", telegram)

    assert result["status"] == "confirmed"
    assert len(telegram.edits) == 1
    edit_chat_id, edit_message_id, edit_text, edit_reply_markup = telegram.edits[0]
    assert edit_chat_id == "42"
    assert edit_message_id == 100
    assert "✅ Операция сохранена" in edit_text
    assert edit_reply_markup is None
    assert telegram.cleared_keyboards == [("42", 100)]
    assert len(telegram.sent_messages) == 1
    sent_chat_id, sent_text, sent_reply_markup = telegram.sent_messages[0]
    assert sent_chat_id == "42"
    assert "✅ Операция сохранена" in sent_text
    assert "🔎 Проверьте операцию перед сохранением" not in sent_text
    assert sent_reply_markup is None


def test_confirm_draft_updates_existing_message_without_duplicate_on_success(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(
            id="parent-1",
            household_id=household_id,
            parent_id=None,
            name="Еда",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category = Category(
            id="cat-1",
            household_id=household_id,
            parent_id=parent.id,
            name="Супермаркеты",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        db.add_all([parent, category])
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.PENDING_REVIEW,
            text="Лидл 130 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft={
                "type": "expense",
                "amount": 130.0,
                "occurredAt": "2026-04-11",
                "categoryId": category.id,
                "categoryName": "Еда / Супермаркеты",
                "comment": "Траты в Лидл",
                "currency": "EUR",
                "confidence": 1,
                "ambiguities": [],
                "followUpQuestion": None,
                "sourceText": "Лидл 130 EUR",
            },
            pending_field=None,
            last_bot_message_id="347",
            active_picker_message_id=None,
        )
        db.add_all([source, review])
        db.commit()

        monkeypatch.setattr(workflows, "enqueue_notification_job", lambda *args, **kwargs: None)
        telegram = FakeTelegram(edit_result=True)

        result = workflows.confirm_draft(db, review.id, "42", "347", telegram)

    assert result["status"] == "confirmed"
    assert len(telegram.edits) == 1
    assert telegram.sent_messages == []
    assert telegram.cleared_keyboards == []


def test_manual_comment_edit_removes_transient_messages_and_sends_fresh_card() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(
            id="parent-1",
            household_id=household_id,
            parent_id=None,
            name="Подписки и сервисы",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category = Category(
            id="cat-1",
            household_id=household_id,
            parent_id=parent.id,
            name="Подписки",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        db.add_all([parent, category])
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.PENDING_REVIEW,
            text="VPS 2 EUR",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.PENDING_REVIEW,
            draft={
                "type": "expense",
                "amount": 2.0,
                "occurredAt": "2026-04-10",
                "categoryId": category.id,
                "categoryName": "Подписки и сервисы / Подписки",
                "comment": None,
                "currency": "EUR",
                "confidence": 1,
                "ambiguities": [],
                "followUpQuestion": None,
                "sourceText": "VPS 2 EUR",
            },
            pending_field="comment",
            last_bot_message_id="100",
            active_picker_message_id="101",
        )
        db.add_all([source, review])
        db.commit()

        telegram = FakeTelegram()
        result = workflows.handle_message_update(
            db,
            {
                "message_id": 151,
                "chat": {"id": 42},
                "from": {"id": 42, "first_name": "User"},
                "text": "VPS, 2 штуки",
            },
            {"update_id": 1},
            telegram,
        )

        updated_review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == review.id)).scalar_one()

    assert result["status"] == "pending_review"
    assert telegram.deleted_messages == [("42", 101), ("42", 151), ("42", 100)]
    assert telegram.cleared_keyboards == []
    assert len(telegram.sent_messages) == 1
    sent_chat_id, sent_text, sent_reply_markup = telegram.sent_messages[0]
    assert sent_chat_id == "42"
    assert "💬 Комментарий: VPS, 2 штуки" in sent_text
    assert sent_reply_markup is not None
    assert sent_reply_markup["inline_keyboard"][0][0]["callback_data"] == "draft:confirm"
    assert updated_review.pending_field is None
    assert updated_review.active_picker_message_id is None
    assert updated_review.last_bot_message_id == "200"
    assert updated_review.draft["comment"] == "VPS, 2 штуки"


def test_category_callback_uses_active_needs_clarification_draft() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(
            id="parent-1",
            household_id=household_id,
            parent_id=None,
            name="Развлечения",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category = Category(
            id="cat-1",
            household_id=household_id,
            parent_id=parent.id,
            name="Развлечения",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category_id = category.id
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            text="15 евро книга",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            draft={
                "type": "expense",
                "amount": 15.0,
                "occurredAt": "2026-04-11",
                "categoryId": None,
                "categoryName": None,
                "comment": "книга",
                "currency": "EUR",
                "confidence": 0.5,
                "ambiguities": [],
                "followUpQuestion": "Для какой категории лучше всего подходит эта покупка?",
                "sourceText": "15 евро книга",
            },
            pending_field=None,
            last_bot_message_id="100",
            active_picker_message_id="101",
        )
        db.add_all([parent, category, source, review])
        db.commit()

        telegram = FakeTelegram(edit_result=True)
        result = workflows.handle_callback_query(
            db,
            {
                "id": "cb-1",
                "data": f"draft:set-category:{category.id}",
                "from": {"id": 42},
                "message": {"message_id": 101, "chat": {"id": 42}},
            },
            telegram,
        )

        updated_review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == review.id)).scalar_one()

    assert result["status"] == "pending_review"
    assert telegram.callback_answers == [("cb-1", None)]
    assert updated_review.draft["categoryId"] == category_id
    assert updated_review.draft["categoryName"] == "Развлечения / Развлечения"


def test_confirm_draft_accepts_needs_clarification_state(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        parent = Category(
            id="parent-1",
            household_id=household_id,
            parent_id=None,
            name="Развлечения",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        category = Category(
            id="cat-1",
            household_id=household_id,
            parent_id=parent.id,
            name="Развлечения",
            type=CategoryType.EXPENSE,
            is_active=True,
        )
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            text="15 евро книга",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            draft={
                "type": "expense",
                "amount": 15.0,
                "occurredAt": "2026-04-11",
                "categoryId": category.id,
                "categoryName": "Развлечения / Развлечения",
                "comment": "книга",
                "currency": "EUR",
                "confidence": 1,
                "ambiguities": [],
                "followUpQuestion": None,
                "sourceText": "15 евро книга",
            },
            pending_field=None,
            last_bot_message_id="347",
            active_picker_message_id=None,
        )
        db.add_all([parent, category, source, review])
        db.commit()

        monkeypatch.setattr(workflows, "enqueue_notification_job", lambda *args, **kwargs: None)
        telegram = FakeTelegram(edit_result=True)
        result = workflows.confirm_draft(db, review.id, "42", "347", telegram)

        updated_review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == review.id)).scalar_one()

    assert result["status"] == "confirmed"
    assert updated_review.status == SourceMessageStatus.PARSED


def test_cancel_draft_accepts_needs_clarification_state() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        source = SourceMessage(
            id="source-1",
            household_id=household_id,
            author_id=user.id,
            telegram_message_id="10",
            telegram_chat_id="42",
            type=SourceMessageType.TELEGRAM_TEXT,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            text="15 евро книга",
            raw_payload={},
        )
        review = PendingOperationReview(
            id="draft-1",
            source_message_id=source.id,
            author_id=user.id,
            status=SourceMessageStatus.NEEDS_CLARIFICATION,
            draft={},
            pending_field=None,
            last_bot_message_id="100",
            active_picker_message_id="101",
        )
        db.add_all([source, review])
        db.commit()

        telegram = FakeTelegram()
        result = workflows.cancel_draft(db, review, "42", telegram)

        updated_review = db.execute(select(PendingOperationReview).where(PendingOperationReview.id == review.id)).scalar_one()

    assert result["status"] == "cancelled"
    assert updated_review.status == SourceMessageStatus.CANCELLED


def test_callback_query_distinguishes_missing_draft_from_missing_user() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)

    with SessionLocal() as db:
        household_id = bootstrap_household_id()
        db.add(Household(id=household_id, name="Дом", default_currency="EUR"))
        user = User(
            id="user-1",
            household_id=household_id,
            email=None,
            password_hash=None,
            display_name="User",
            role=UserRole.MEMBER,
        )
        db.add(user)
        db.add(TelegramAccount(user_id=user.id, telegram_id="42", username=None, first_name=None, last_name=None, is_active=True))
        db.commit()

        telegram = FakeTelegram()
        result_existing_user = workflows.handle_callback_query(
            db,
            {
                "id": "cb-1",
                "data": "draft:confirm",
                "from": {"id": 42},
                "message": {"message_id": 101, "chat": {"id": 42}},
            },
            telegram,
        )
        result_missing_user = workflows.handle_callback_query(
            db,
            {
                "id": "cb-2",
                "data": "draft:confirm",
                "from": {"id": 404},
                "message": {"message_id": 102, "chat": {"id": 404}},
            },
            telegram,
        )

    assert result_existing_user["ignored"] is True
    assert result_missing_user["ignored"] is True
    assert telegram.callback_answers == [
        ("cb-1", "Черновик не найден или уже завершен"),
        ("cb-2", "Пользователь не найден"),
    ]
