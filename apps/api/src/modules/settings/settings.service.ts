import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const household = await this.prisma.household.findUniqueOrThrow({
      where: { id: BOOTSTRAP_HOUSEHOLD_ID },
    });
    const settings = await this.prisma.appSetting.findMany({
      where: { householdId: BOOTSTRAP_HOUSEHOLD_ID },
    });

    const values = Object.fromEntries(settings.map((item) => [item.key, item.value]));

    return {
      householdName: household.name,
      defaultCurrency: 'EUR',
      telegramMode: values.telegramMode ?? 'polling',
      aiModel: values.aiModel ?? process.env.POLZA_MODEL ?? 'google/gemini-2.5-flash',
      clarificationTimeoutMinutes: Number(
        values.clarificationTimeoutMinutes ?? '30',
      ),
      parsingPrompt:
        values.parsingPrompt ??
        'Ты разбираешь семейные доходы и расходы из сообщений Telegram. Верни только JSON. Все новые операции в этой системе должны быть только в EUR, resolvedCurrency всегда EUR. categoryCandidate должен быть только одним точным значением из списка доступных категорий или null, если категорию нельзя определить. Нельзя придумывать новые категории, merchant names, английские синонимы или произвольные ярлыки. Если в сообщении есть магазин или merchant, выбери ближайшую подходящую категорию именно из списка доступных категорий. Если пользователь не указал дату явно, используй текущую дату из контекста currentDate.',
      clarificationPrompt:
        values.clarificationPrompt ??
        'Используй историю уточнения и ответ пользователя, чтобы заполнить недостающие поля той же самой операции. Итоговая валюта операции всегда EUR. Категорию можно выбирать только из переданного списка доступных категорий. Если дата не названа явно, используй текущую дату из currentDate. Не возвращай merchant name вместо категории.',
    };
  }

  async update(dto: UpdateSettingsDto) {
    await this.prisma.household.update({
      where: { id: BOOTSTRAP_HOUSEHOLD_ID },
      data: {
        name: dto.householdName,
        defaultCurrency: 'EUR',
      },
    });

    const entries: Record<string, string> = {
      telegramMode: dto.telegramMode,
      aiModel: dto.aiModel,
      clarificationTimeoutMinutes: String(dto.clarificationTimeoutMinutes),
      parsingPrompt: dto.parsingPrompt,
      clarificationPrompt: dto.clarificationPrompt,
    };

    await Promise.all(
      Object.entries(entries).map(([key, value]) =>
        this.prisma.appSetting.upsert({
          where: {
            householdId_key: {
              householdId: BOOTSTRAP_HOUSEHOLD_ID,
              key,
            },
          },
          update: { value },
          create: {
            householdId: BOOTSTRAP_HOUSEHOLD_ID,
            key,
            value,
          },
        }),
      ),
    );

    return this.getSettings();
  }
}
