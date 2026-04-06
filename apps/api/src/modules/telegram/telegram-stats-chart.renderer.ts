import { Injectable } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import type { CurrentMonthExpenseBreakdown } from '../transaction/transaction.service';

@Injectable()
export class TelegramStatsChartRenderer {
  private readonly width = 1100;
  private readonly height = 720;
  private readonly centerX = 290;
  private readonly centerY = 380;
  private readonly radius = 190;
  private readonly colors = [
    '#2563eb',
    '#dc2626',
    '#16a34a',
    '#d97706',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#65a30d',
    '#ea580c',
    '#475569',
  ];

  renderExpenseBreakdown(input: CurrentMonthExpenseBreakdown) {
    const canvas = createCanvas(this.width, this.height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = '#0f172a';
    context.font = 'bold 38px sans-serif';
    context.fillText(`Расходы за ${input.periodLabel.toLowerCase()}`, 60, 70);

    context.fillStyle = '#475569';
    context.font = '24px sans-serif';
    context.fillText(`Общая сумма: ${this.formatMoney(input.totalExpense)}`, 60, 110);

    if (input.items.length === 0) {
      context.fillStyle = '#334155';
      context.font = '28px sans-serif';
      context.fillText('Нет данных для построения диаграммы', 60, 180);
      return canvas.toBuffer('image/png');
    }

    let startAngle = -Math.PI / 2;
    input.items.forEach((item, index) => {
      const sweep = Math.PI * 2 * item.share;
      context.beginPath();
      context.moveTo(this.centerX, this.centerY);
      context.arc(this.centerX, this.centerY, this.radius, startAngle, startAngle + sweep);
      context.closePath();
      context.fillStyle = this.colors[index % this.colors.length];
      context.fill();
      startAngle += sweep;
    });

    context.beginPath();
    context.arc(this.centerX, this.centerY, this.radius * 0.54, 0, Math.PI * 2);
    context.fillStyle = '#f8fafc';
    context.fill();

    context.fillStyle = '#0f172a';
    context.font = 'bold 28px sans-serif';
    context.textAlign = 'center';
    context.fillText('Итого', this.centerX, this.centerY - 10);
    context.font = 'bold 26px sans-serif';
    context.fillText(this.formatMoney(input.totalExpense), this.centerX, this.centerY + 28);
    context.textAlign = 'start';

    context.fillStyle = '#0f172a';
    context.font = 'bold 26px sans-serif';
    context.fillText('Категории', 560, 160);

    input.items.forEach((item, index) => {
      const top = 210 + index * 46;
      context.fillStyle = this.colors[index % this.colors.length];
      context.fillRect(560, top - 18, 22, 22);

      context.fillStyle = '#0f172a';
      context.font = '22px sans-serif';
      context.fillText(item.categoryName, 598, top);

      context.fillStyle = '#334155';
      context.font = '20px sans-serif';
      context.fillText(
        `${this.formatMoney(item.amount)} · ${(item.share * 100).toFixed(1)}%`,
        860,
        top,
      );
    });

    return canvas.toBuffer('image/png');
  }

  private formatMoney(value: number) {
    return value.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
