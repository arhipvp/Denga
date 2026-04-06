import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { CurrentMonthExpenseBreakdown } from '../transaction/transaction.service';

@Injectable()
export class TelegramStatsChartRenderer {
  private readonly width = 1200;
  private readonly height = 760;
  private readonly centerX = 290;
  private readonly centerY = 380;
  private readonly radius = 190;
  private readonly fontFamily = TelegramStatsChartRenderer.ensureFontFamily();
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
  private static registeredFontFamily?: string;

  renderExpenseBreakdown(input: CurrentMonthExpenseBreakdown) {
    const canvas = createCanvas(this.width, this.height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = '#0f172a';
    context.font = `700 38px "${this.fontFamily}"`;
    context.fillText(`Расходы за ${input.periodLabel.toLowerCase()}`, 60, 70);

    context.fillStyle = '#475569';
    context.font = `500 24px "${this.fontFamily}"`;
    context.fillText(
      `Общая сумма: ${this.formatMoney(input.totalExpense, input.currency)}`,
      60,
      110,
    );

    if (input.items.length === 0) {
      context.fillStyle = '#334155';
      context.font = `500 28px "${this.fontFamily}"`;
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
    context.textAlign = 'center';
    context.font = `700 28px "${this.fontFamily}"`;
    context.fillText('Итого', this.centerX, this.centerY - 10);
    context.font = `700 23px "${this.fontFamily}"`;
    context.fillText(
      this.formatMoney(input.totalExpense, input.currency),
      this.centerX,
      this.centerY + 28,
    );
    context.textAlign = 'start';

    context.fillStyle = '#0f172a';
    context.font = `700 26px "${this.fontFamily}"`;
    context.fillText('Категории', 560, 160);

    input.items.forEach((item, index) => {
      const top = 210 + index * 70;
      const legendWidth = 620;
      const nameWidth = 270;

      context.fillStyle = this.colors[index % this.colors.length];
      context.fillRect(560, top - 20, 24, 24);

      context.fillStyle = '#0f172a';
      context.font = `600 21px "${this.fontFamily}"`;
      context.fillText(this.ellipsizeText(context, item.categoryName, nameWidth), 600, top);

      context.fillStyle = '#334155';
      context.font = `500 19px "${this.fontFamily}"`;
      context.fillText(
        this.ellipsizeText(
          context,
          `${this.formatMoney(item.amount, input.currency)} · ${(item.share * 100).toFixed(1)}%`,
          legendWidth - 40 - nameWidth,
        ),
        880,
        top,
      );
    });

    return canvas.toBuffer('image/png');
  }

  private ellipsizeText(context: { measureText(text: string): { width: number } }, text: string, maxWidth: number) {
    if (context.measureText(text).width <= maxWidth) {
      return text;
    }

    let value = text;
    while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) {
      value = value.slice(0, -1);
    }

    return `${value}…`;
  }

  private formatMoney(value: number, currency: string) {
    return `${value.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }

  private static ensureFontFamily() {
    if (TelegramStatsChartRenderer.registeredFontFamily) {
      return TelegramStatsChartRenderer.registeredFontFamily;
    }

    const candidates = [
      {
        family: 'TelegramStatsFont',
        path: 'C:\\Windows\\Fonts\\arial.ttf',
      },
      {
        family: 'TelegramStatsFont',
        path: 'C:\\Windows\\Fonts\\segoeui.ttf',
      },
      {
        family: 'TelegramStatsFont',
        path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      },
      {
        family: 'TelegramStatsFont',
        path: '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      },
    ];

    for (const candidate of candidates) {
      if (!existsSync(candidate.path)) {
        continue;
      }

      try {
        GlobalFonts.registerFromPath(candidate.path, candidate.family);
        TelegramStatsChartRenderer.registeredFontFamily = candidate.family;
        return candidate.family;
      } catch {
        // Try the next available font candidate.
      }
    }

    TelegramStatsChartRenderer.registeredFontFamily = 'sans-serif';
    return 'sans-serif';
  }
}
