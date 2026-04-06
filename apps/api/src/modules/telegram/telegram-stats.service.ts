import { Injectable } from '@nestjs/common';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramStatsChartRenderer } from './telegram-stats-chart.renderer';
import { TransactionService } from '../transaction/transaction.service';

@Injectable()
export class TelegramStatsService {
  private static readonly telegramCaptionLimit = 1024;

  constructor(
    private readonly transactionService: TransactionService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramStatsChartRenderer: TelegramStatsChartRenderer,
  ) {}

  async sendCurrentMonthExpenseReport(chatId: string) {
    const breakdown = await this.transactionService.getCurrentMonthExpenseBreakdown();

    if (breakdown.totalExpense <= 0 || breakdown.items.length === 0) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        'В этом месяце подтвержденных расходов пока нет.',
      );
      return { accepted: true, status: 'stats_empty' };
    }

    const chart = this.telegramStatsChartRenderer.renderExpenseBreakdown(breakdown);
    const fullCaption = this.buildExpenseCaption(breakdown);
    const shortCaption = this.buildShortCaption(breakdown);
    const caption =
      fullCaption.length <= TelegramStatsService.telegramCaptionLimit
        ? fullCaption
        : shortCaption;

    await this.telegramDeliveryService.sendTelegramPhoto({
      chatId,
      fileName: 'expense-current-month.png',
      photo: chart,
      caption,
    });

    if (caption !== fullCaption) {
      await this.telegramDeliveryService.sendTelegramMessage(chatId, fullCaption);
    }

    return { accepted: true, status: 'stats_sent' };
  }

  private buildExpenseCaption(input: Awaited<ReturnType<TransactionService['getCurrentMonthExpenseBreakdown']>>) {
    const lines = [
      `<b>Отчет по расходам</b>`,
      `Период: <b>${input.periodLabel.toLowerCase()}</b>`,
      `Итого: <b>${this.formatMoney(input.totalExpense, input.currency)}</b>`,
      '',
      `<b>Категории</b>`,
      ...input.items.map(
        (item) =>
          `• ${item.categoryName} — <b>${this.formatMoney(item.amount, input.currency)}</b> (${(item.share * 100).toFixed(1)}%)`,
      ),
    ];

    return lines.join('\n');
  }

  private buildShortCaption(
    input: Awaited<ReturnType<TransactionService['getCurrentMonthExpenseBreakdown']>>,
  ) {
    return [
      `<b>Отчет по расходам</b>`,
      `Период: <b>${input.periodLabel.toLowerCase()}</b>`,
      `Итого: <b>${this.formatMoney(input.totalExpense, input.currency)}</b>`,
      'Полный список категорий отправлен следующим сообщением.',
    ].join('\n');
  }

  private formatMoney(value: number, currency: string) {
    return `${value.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }
}
