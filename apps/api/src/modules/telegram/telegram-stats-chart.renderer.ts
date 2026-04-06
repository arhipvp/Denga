import { Injectable } from '@nestjs/common';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import type {
  CurrentMonthExpenseBreakdown,
  CurrentMonthExpenseBreakdownItem,
} from '../transaction/transaction.types';

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

  renderExpenseBreakdown(input: CurrentMonthExpenseBreakdown) {
    return this.renderExpenseBreakdownCanvas(input).toBuffer('image/png');
  }

  renderExpenseBreakdownCanvas(input: CurrentMonthExpenseBreakdown) {
    const canvas = createCanvas(this.width, this.height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = '#0f172a';
    this.setFont(context, 38, 'bold');
    context.fillText(`Расходы за ${input.periodLabel.toLowerCase()}`, 60, 70);

    context.fillStyle = '#475569';
    this.setFont(context, 24, 'normal');
    context.fillText(
      `Общая сумма: ${this.formatMoney(input.totalExpense, input.currency)}`,
      60,
      110,
    );

    if (input.items.length === 0) {
      context.fillStyle = '#334155';
      this.setFont(context, 28, 'normal');
      context.fillText('Нет данных для построения диаграммы', 60, 180);
      return canvas;
    }

    let startAngle = -Math.PI / 2;
    input.items.forEach((item: CurrentMonthExpenseBreakdownItem, index: number) => {
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
    this.setFont(context, 28, 'bold');
    context.fillText('Итого', this.centerX, this.centerY - 10);
    this.setFont(context, 23, 'bold');
    context.fillText(
      this.formatMoney(input.totalExpense, input.currency),
      this.centerX,
      this.centerY + 28,
    );
    context.textAlign = 'start';

    context.fillStyle = '#0f172a';
    this.setFont(context, 26, 'bold');
    context.fillText('Категории', 560, 160);

    input.items.forEach((item: CurrentMonthExpenseBreakdownItem, index: number) => {
      const top = 210 + index * 70;
      const nameWidth = 270;
      const valueWidth = 250;

      context.fillStyle = this.colors[index % this.colors.length];
      context.fillRect(560, top - 20, 24, 24);

      context.fillStyle = '#0f172a';
      this.setFont(context, 21, 'bold');
      context.fillText(this.ellipsizeText(context, item.categoryName, nameWidth), 600, top);

      context.fillStyle = '#334155';
      this.setFont(context, 19, 'normal');
      context.fillText(
        this.ellipsizeText(
          context,
          `${this.formatMoney(item.amount, input.currency)} · ${(item.share * 100).toFixed(1)}%`,
          valueWidth,
        ),
        880,
        top,
      );
    });

    return canvas;
  }

  private setFont(context: SKRSContext2D, size: number, weight: 'normal' | 'bold') {
    context.font = `${weight} ${size}px ${this.fontFamily}`;
  }

  private ellipsizeText(
    context: Pick<SKRSContext2D, 'measureText'>,
    text: string,
    maxWidth: number,
  ) {
    if (context.measureText(text).width <= maxWidth) {
      return text;
    }

    let value = text;
    while (value.length > 1 && context.measureText(`${value}...`).width > maxWidth) {
      value = value.slice(0, -1);
    }

    return `${value}...`;
  }

  private formatMoney(value: number, currency: string) {
    return `${value.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }

  private static pickFontFamily() {
    const families = typeof GlobalFonts.families === 'object' ? GlobalFonts.families : [];
    const available = new Set(
      Array.isArray(families)
        ? families
            .map((entry) => entry?.family)
            .filter((family): family is string => Boolean(family))
        : [],
    );

    const preferred = ['Arial', 'Segoe UI', 'DejaVu Sans', 'Liberation Sans', 'sans-serif'];
    for (const family of preferred) {
      if (family === 'sans-serif' || available.has(family)) {
        return family;
      }
    }

    return 'sans-serif';
  }

  private static ensureFontFamily() {
    const fontCandidates = [
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/usr/local/share/fonts/DejaVuSans.ttf',
    ];
    const fontDirectories = ['/usr/share/fonts', '/usr/local/share/fonts'];

    for (const directory of fontDirectories) {
      if (existsSync(directory)) {
        GlobalFonts.loadFontsFromDir(directory);
      }
    }

    for (const fontPath of fontCandidates) {
      if (existsSync(fontPath)) {
        GlobalFonts.registerFromPath(fontPath, 'Denga Stats Sans');
      }
    }

    const families = typeof GlobalFonts.families === 'object' ? GlobalFonts.families : [];
    const availableFamilies = new Set(
      Array.isArray(families)
        ? families
            .map((entry) => entry?.family)
            .filter((family): family is string => Boolean(family))
        : [],
    );

    if (availableFamilies.has('Denga Stats Sans')) {
      return '"Denga Stats Sans"';
    }

    return TelegramStatsChartRenderer.pickFontFamily();
  }
}
