import { Injectable } from '@nestjs/common';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramStatsChartRenderer } from './telegram-stats-chart.renderer';
import { TransactionService } from '../transaction/transaction.service';
import type { CurrentMonthCategoryBreakdown } from '../transaction/transaction.types';

type TelegramStatsReportDefinition = {
  chartFileName: string;
  chartTitle: string;
  emptyStateText: string;
  reportTitle: string;
};

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
    return this.sendCurrentMonthReport(chatId, breakdown, {
      chartFileName: 'expense-current-month.png',
      chartTitle: 'Расходы',
      emptyStateText: 'В этом месяце подтвержденных расходов пока нет.',
      reportTitle: 'Отчет по расходам',
    });
  }

  async sendCurrentMonthIncomeReport(chatId: string) {
    const breakdown = await this.transactionService.getCurrentMonthIncomeBreakdown();
    return this.sendCurrentMonthReport(chatId, breakdown, {
      chartFileName: 'income-current-month.png',
      chartTitle: 'Доходы',
      emptyStateText: 'В этом месяце подтвержденных доходов пока нет.',
      reportTitle: 'Отчет по доходам',
    });
  }

  private async sendCurrentMonthReport(
    chatId: string,
    breakdown: CurrentMonthCategoryBreakdown,
    definition: TelegramStatsReportDefinition,
  ) {
    if (breakdown.totalAmount <= 0 || breakdown.items.length === 0) {
      await this.telegramDeliveryService.sendTelegramMessage(chatId, definition.emptyStateText);
      return { accepted: true, status: 'stats_empty' };
    }

    const chart = this.telegramStatsChartRenderer.renderCategoryBreakdown(
      breakdown,
      definition.chartTitle,
    );
    const fullCaption = this.buildCaption(breakdown, definition);
    const shortCaption = this.buildShortCaption(breakdown, definition);
    const caption =
      fullCaption.length <= TelegramStatsService.telegramCaptionLimit
        ? fullCaption
        : shortCaption;

    await this.telegramDeliveryService.sendTelegramPhoto({
      chatId,
      fileName: definition.chartFileName,
      photo: chart,
      caption,
    });

    if (caption !== fullCaption) {
      await this.telegramDeliveryService.sendTelegramMessage(chatId, fullCaption);
    }

    return { accepted: true, status: 'stats_sent' };
  }

  private buildCaption(
    input: CurrentMonthCategoryBreakdown,
    definition: TelegramStatsReportDefinition,
  ) {
    const lines = [
      `<b>${definition.reportTitle}</b>`,
      `Период: <b>${input.periodLabel.toLowerCase()}</b>`,
      `Итого: <b>${this.formatMoney(input.totalAmount, input.currency)}</b>`,
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
    input: CurrentMonthCategoryBreakdown,
    definition: TelegramStatsReportDefinition,
  ) {
    return [
      `<b>${definition.reportTitle}</b>`,
      `Период: <b>${input.periodLabel.toLowerCase()}</b>`,
      `Итого: <b>${this.formatMoney(input.totalAmount, input.currency)}</b>`,
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
