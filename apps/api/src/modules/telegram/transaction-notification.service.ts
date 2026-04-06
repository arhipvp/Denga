import { Injectable, Logger } from '@nestjs/common';
import { format } from 'date-fns';
import { TransactionType } from '@prisma/client';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramDeliveryService } from './telegram-delivery.service';

type TransactionNotificationOptions = {
  excludeTelegramIds?: string[];
};

type TransactionNotificationEvent = 'created' | 'deleted';

@Injectable()
export class TransactionNotificationService {
  private readonly logger = new Logger(TransactionNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly householdContext: HouseholdContextService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
  ) {}

  async notifyTransactionCreated(
    transactionId: string,
    options?: TransactionNotificationOptions,
  ) {
    return this.notifyTransactionEvent('created', transactionId, options);
  }

  async notifyTransactionDeleted(
    transactionId: string,
    options?: TransactionNotificationOptions,
  ) {
    return this.notifyTransactionEvent('deleted', transactionId, options);
  }

  private async notifyTransactionEvent(
    event: TransactionNotificationEvent,
    transactionId: string,
    options?: TransactionNotificationOptions,
  ) {
    const householdId = this.householdContext.getHouseholdId();
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        householdId,
      },
      include: {
        author: true,
        category: true,
      },
    });

    if (!transaction) {
      this.logger.warn(`transaction_not_found id=${transactionId}`);
      return { recipients: 0, delivered: 0, failed: 0 };
    }

    const excludedTelegramIds = new Set(
      (options?.excludeTelegramIds ?? [])
        .map((item) => item.trim())
        .filter((value) => value.length > 0),
    );

    const recipientRecords = await this.prisma.telegramAccount.findMany({
      where: {
        isActive: true,
        user: {
          householdId,
        },
      },
      select: {
        telegramId: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const recipientIds = Array.from(
      new Set(
        recipientRecords
          .map((item) => item.telegramId?.trim())
          .filter(
            (value): value is string =>
              Boolean(value) && !excludedTelegramIds.has(value),
          ),
      ),
    );

    if (recipientIds.length === 0) {
      this.logger.debug(
        `transaction_notification_skipped id=${transactionId} event=${event} reason=no_recipients`,
      );
      return { recipients: 0, delivered: 0, failed: 0 };
    }

    const message = this.buildMessage({
      event,
      type: transaction.type,
      amount: String(transaction.amount),
      currency: transaction.currency,
      occurredAt: transaction.occurredAt,
      categoryName: transaction.category?.name ?? null,
      comment: transaction.comment,
      authorName: transaction.author?.displayName ?? null,
    });

    const results = await Promise.allSettled(
      recipientIds.map(async (chatId) => {
        await this.telegramDeliveryService.sendTelegramMessage(chatId, message);
        return chatId;
      }),
    );

    let delivered = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        delivered += 1;
        continue;
      }

      failed += 1;
      this.logger.error(
        `transaction_notification_failed id=${transactionId} event=${event}`,
        result.reason instanceof Error ? result.reason.stack : String(result.reason),
      );
    }

    return {
      recipients: recipientIds.length,
      delivered,
      failed,
    };
  }

  private buildMessage(input: {
    event: TransactionNotificationEvent;
    type: TransactionType;
    amount: string;
    currency: string;
    occurredAt: Date;
    categoryName: string | null;
    comment: string | null;
    authorName: string | null;
  }) {
    return [
      input.event === 'created' ? 'Добавлена новая операция' : 'Операция удалена',
      '',
      `Тип: ${input.type === TransactionType.INCOME ? 'Доход' : 'Расход'}`,
      `Сумма: ${this.escapeHtml(input.amount)} ${this.escapeHtml(input.currency)}`.trim(),
      `Дата: ${format(input.occurredAt, 'dd.MM.yyyy')}`,
      `Категория: ${this.escapeHtml(input.categoryName ?? 'Не указана')}`,
      `Комментарий: ${this.escapeHtml(input.comment ?? 'Не указан')}`,
      ...(input.authorName ? [`Автор: ${this.escapeHtml(input.authorName)}`] : []),
    ].join('\n');
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
