from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models import AppSetting, Household, TelegramAccount, User, UserRole
from app.security import hash_password


DEFAULT_PARSING_PROMPT = """Ты разбираешь семейные доходы и расходы из сообщений Telegram.

Нужно извлечь ровно одну финансовую операцию и вернуть только JSON.

Правила:
- type: income или expense.
- amount: число без валютного символа, всегда в евро.
- occurredAt: ISO datetime. Если пользователь пишет "сегодня", "текущая", "текущий день", используй текущую дату.
- categoryCandidate: выбери одно точное имя категории из переданного списка категорий. Не придумывай новых категорий.
- comment: короткий комментарий по смыслу сообщения.
- confidence: от 0 до 1.
- ambiguities: список реально недостающих или спорных полей.
- followUpQuestion: один короткий вопрос пользователю, если без уточнения нельзя надежно завершить разбор.
- resolvedCurrency: всегда возвращай "EUR".

Жесткое правило по валюте:
- все новые операции в этой системе должны быть только в евро;
- никогда не возвращай RUB, USD или любую другую валюту;
- если в сообщении или чеке указана другая валюта, все равно нормализуй итоговую операцию к EUR;
- если источник содержит другую валюту, считай это только контекстом, но итоговый JSON формируй в евро.

Разумные дефолты:
- бытовые траты, поездки, покупки, сервисы и услуги без признаков дохода по умолчанию считаются expense;
- валюта операции всегда EUR;
- если пользовательский intent похож на "такси", выбирай категорию "Транспорт", если она есть в списке.

Если данных уже достаточно, ambiguities должен быть пустым массивом, а followUpQuestion = null."""

DEFAULT_CLARIFICATION_PROMPT = (
    "Используй историю уточнения и ответ пользователя, чтобы заполнить недостающие поля той же самой операции. "
    "Итоговая валюта операции всегда EUR, даже если в сообщении или чеке встречается другая валюта."
)


def _upsert_telegram_account(
    session,
    *,
    user_id: str,
    telegram_id: str | None,
) -> None:
    if not telegram_id:
        return

    account = session.execute(
        select(TelegramAccount).where(TelegramAccount.telegram_id == telegram_id)
    ).scalar_one_or_none()
    if account:
        account.user_id = user_id
        account.is_active = True
        return

    session.add(
        TelegramAccount(
            user_id=user_id,
            telegram_id=telegram_id,
            is_active=True,
        )
    )


def _upsert_setting(session, *, household_id: str, key: str, value: str) -> None:
    setting = session.execute(
        select(AppSetting).where(AppSetting.household_id == household_id, AppSetting.key == key)
    ).scalar_one_or_none()
    if setting:
        setting.value = value
        return
    session.add(AppSetting(household_id=household_id, key=key, value=value))


def main() -> int:
    settings = get_settings()
    household_id = settings.bootstrap_household_id
    household_name = settings.household_name
    default_currency = settings.default_currency
    admin_email = settings.admin_email
    admin_password = settings.admin_password
    admin_telegram_id = settings.admin_telegram_id
    second_user_telegram_id = settings.second_user_telegram_id

    with SessionLocal() as session:
        household = session.execute(select(Household).where(Household.id == household_id)).scalar_one_or_none()
        if household:
            household.name = household_name
            household.default_currency = default_currency
        else:
            household = Household(
                id=household_id,
                name=household_name,
                default_currency=default_currency,
            )
            session.add(household)
            session.flush()

        admin_user = session.execute(select(User).where(User.email == admin_email)).scalar_one_or_none()
        password_hash = hash_password(admin_password)
        if admin_user:
            admin_user.display_name = "Администратор"
            admin_user.password_hash = password_hash
            admin_user.role = UserRole.ADMIN
            admin_user.household_id = household.id
        else:
            admin_user = User(
                household_id=household.id,
                email=admin_email,
                display_name="Администратор",
                password_hash=password_hash,
                role=UserRole.ADMIN,
            )
            session.add(admin_user)
            session.flush()

        _upsert_telegram_account(session, user_id=admin_user.id, telegram_id=admin_telegram_id)

        if second_user_telegram_id:
            second_user = session.execute(
                select(User).where(User.email == "member@example.local")
            ).scalar_one_or_none()
            if second_user:
                second_user.display_name = "Второй участник"
                second_user.household_id = household.id
                second_user.role = UserRole.MEMBER
            else:
                second_user = User(
                    household_id=household.id,
                    email="member@example.local",
                    display_name="Второй участник",
                    role=UserRole.MEMBER,
                )
                session.add(second_user)
                session.flush()
            _upsert_telegram_account(session, user_id=second_user.id, telegram_id=second_user_telegram_id)

        bootstrap_settings = {
            "parsingPrompt": DEFAULT_PARSING_PROMPT,
            "clarificationPrompt": DEFAULT_CLARIFICATION_PROMPT,
            "telegramMode": settings.telegram_mode,
            "aiModel": settings.polza_model,
            "clarificationTimeoutMinutes": str(settings.clarification_timeout_minutes),
        }
        for key, value in bootstrap_settings.items():
            _upsert_setting(session, household_id=household.id, key=key, value=value)

        session.commit()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
