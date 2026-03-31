import 'dotenv/config';
import bcrypt from 'bcrypt';
import { CategoryType, PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const categories: Array<{ name: string; type: CategoryType }> = [
  { name: 'Продукты', type: CategoryType.EXPENSE },
  { name: 'Кафе и рестораны', type: CategoryType.EXPENSE },
  { name: 'Транспорт', type: CategoryType.EXPENSE },
  { name: 'Авто', type: CategoryType.EXPENSE },
  { name: 'Дом и быт', type: CategoryType.EXPENSE },
  { name: 'Коммунальные услуги', type: CategoryType.EXPENSE },
  { name: 'Здоровье', type: CategoryType.EXPENSE },
  { name: 'Ребенок', type: CategoryType.EXPENSE },
  { name: 'Образование', type: CategoryType.EXPENSE },
  { name: 'Одежда', type: CategoryType.EXPENSE },
  { name: 'Развлечения', type: CategoryType.EXPENSE },
  { name: 'Подписки и сервисы', type: CategoryType.EXPENSE },
  { name: 'Подарки', type: CategoryType.EXPENSE },
  { name: 'Путешествия', type: CategoryType.EXPENSE },
  { name: 'Прочее', type: CategoryType.EXPENSE },
  { name: 'Зарплата', type: CategoryType.INCOME },
  { name: 'Подработка', type: CategoryType.INCOME },
  { name: 'Подарки и переводы', type: CategoryType.INCOME },
  { name: 'Возвраты', type: CategoryType.INCOME },
  { name: 'Прочий доход', type: CategoryType.INCOME },
];
const defaultParsingPrompt = `Ты разбираешь семейные доходы и расходы из сообщений Telegram.

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

Если данных уже достаточно, ambiguities должен быть пустым массивом, а followUpQuestion = null.`;

async function main() {
  const householdName = process.env.HOUSEHOLD_NAME ?? 'Моя семья';
  const defaultCurrency = process.env.DEFAULT_CURRENCY ?? 'EUR';
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me-now';
  const adminTelegramId = process.env.ADMIN_TELEGRAM_ID;
  const secondUserTelegramId = process.env.SECOND_USER_TELEGRAM_ID;

  const household = await prisma.household.upsert({
    where: { id: 'bootstrap-household' },
    update: {
      name: householdName,
      defaultCurrency,
    },
    create: {
      id: 'bootstrap-household',
      name: householdName,
      defaultCurrency,
    },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      displayName: 'Администратор',
      passwordHash,
      role: UserRole.ADMIN,
      householdId: household.id,
    },
    create: {
      email: adminEmail,
      displayName: 'Администратор',
      passwordHash,
      role: UserRole.ADMIN,
      householdId: household.id,
    },
  });

  if (adminTelegramId) {
    await prisma.telegramAccount.upsert({
      where: { telegramId: adminTelegramId },
      update: {
        userId: adminUser.id,
        isActive: true,
      },
      create: {
        userId: adminUser.id,
        telegramId: adminTelegramId,
        isActive: true,
      },
    });
  }

  if (secondUserTelegramId) {
    const secondUser = await prisma.user.upsert({
      where: {
        email: 'member@example.local',
      },
      update: {
        displayName: 'Второй участник',
        householdId: household.id,
        role: UserRole.MEMBER,
      },
      create: {
        email: 'member@example.local',
        displayName: 'Второй участник',
        householdId: household.id,
        role: UserRole.MEMBER,
      },
    });

    await prisma.telegramAccount.upsert({
      where: { telegramId: secondUserTelegramId },
      update: {
        userId: secondUser.id,
        isActive: true,
      },
      create: {
        userId: secondUser.id,
        telegramId: secondUserTelegramId,
        isActive: true,
      },
    });
  }

  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        householdId_name: {
          householdId: household.id,
          name: category.name,
        },
      },
      update: { isActive: true, type: category.type },
      create: {
        householdId: household.id,
        name: category.name,
        type: category.type,
        isActive: true,
      },
    });
  }

  const settings = {
    parsingPrompt: defaultParsingPrompt,
    clarificationPrompt:
      'Используй историю уточнения и ответ пользователя, чтобы заполнить недостающие поля той же самой операции. Итоговая валюта операции всегда EUR, даже если в сообщении или чеке встречается другая валюта.',
    telegramMode: process.env.TELEGRAM_MODE ?? 'polling',
    aiModel: process.env.POLZA_MODEL ?? 'google/gemini-2.5-flash',
    clarificationTimeoutMinutes:
      process.env.CLARIFICATION_TIMEOUT_MINUTES ?? '30',
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.appSetting.upsert({
      where: {
        householdId_key: {
          householdId: household.id,
          key,
        },
      },
      update: { value },
      create: {
        householdId: household.id,
        key,
        value,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
