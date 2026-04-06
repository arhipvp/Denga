import { Injectable } from '@nestjs/common';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import type {
  CurrentMonthCategoryBreakdown,
  CurrentMonthCategoryBreakdownItem,
} from '../transaction/transaction.types';

type ChartSegmentLayout = {
  color: string;
  midAngle: number;
  share: number;
  sweep: number;
};

@Injectable()
export class TelegramStatsChartRenderer {
  private readonly width = 1200;
  private readonly height = 760;
  private readonly centerX = 290;
  private readonly centerY = 380;
  private readonly radius = 190;
  private readonly legendMarkerX = 560;
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

  renderCategoryBreakdown(input: CurrentMonthCategoryBreakdown, reportTitle: string) {
    return this.renderCategoryBreakdownCanvas(input, reportTitle).toBuffer('image/png');
  }

  renderCategoryBreakdownCanvas(input: CurrentMonthCategoryBreakdown, reportTitle: string) {
    const canvas = createCanvas(this.width, this.height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, this.width, this.height);

    context.fillStyle = '#0f172a';
    this.setFont(context, 38, 'bold');
    context.fillText(`${reportTitle} за ${input.periodLabel.toLowerCase()}`, 60, 70);

    context.fillStyle = '#475569';
    this.setFont(context, 24, 'normal');
    context.fillText(
      `Общая сумма: ${this.formatMoney(input.totalAmount, input.currency)}`,
      60,
      110,
    );

    if (input.items.length === 0) {
      context.fillStyle = '#334155';
      this.setFont(context, 28, 'normal');
      context.fillText('Нет данных для построения диаграммы', 60, 180);
      return canvas;
    }

    const segments: ChartSegmentLayout[] = [];
    let startAngle = -Math.PI / 2;
    input.items.forEach((item: CurrentMonthCategoryBreakdownItem, index: number) => {
      const sweep = Math.PI * 2 * item.share;
      const endAngle = startAngle + sweep;
      const color = this.colors[index % this.colors.length];
      context.beginPath();
      context.moveTo(this.centerX, this.centerY);
      context.arc(this.centerX, this.centerY, this.radius, startAngle, endAngle);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      segments.push({
        color,
        midAngle: startAngle + sweep / 2,
        share: item.share,
        sweep,
      });
      startAngle = endAngle;
    });

    this.drawSegmentPercentLabels(context, segments);

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
      this.formatMoney(input.totalAmount, input.currency),
      this.centerX,
      this.centerY + 28,
    );
    context.textAlign = 'start';

    context.fillStyle = '#0f172a';
    this.setFont(context, 26, 'bold');
    context.fillText('Категории', 560, 160);

    input.items.forEach((item: CurrentMonthCategoryBreakdownItem, index: number) => {
      const top = 210 + index * 70;
      const nameWidth = 270;
      const valueWidth = 250;

      context.fillStyle = this.colors[index % this.colors.length];
      context.fillRect(this.legendMarkerX, top - 20, 24, 24);

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

  renderExpenseBreakdown(input: CurrentMonthCategoryBreakdown) {
    return this.renderCategoryBreakdown(input, 'Расходы');
  }

  renderExpenseBreakdownCanvas(input: CurrentMonthCategoryBreakdown) {
    return this.renderCategoryBreakdownCanvas(input, 'Расходы');
  }

  private drawSegmentPercentLabels(context: SKRSContext2D, segments: ChartSegmentLayout[]) {
    const innerRadius = this.radius * 0.54;
    const labelRadius = (this.radius + innerRadius) / 2;

    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    this.setFont(context, 19, 'bold');

    for (const segment of segments) {
      const label = `${(segment.share * 100).toFixed(1)}%`;
      if (!this.canRenderSegmentLabel(context, label, segment, labelRadius)) {
        continue;
      }

      const x = this.centerX + Math.cos(segment.midAngle) * labelRadius;
      const y = this.centerY + Math.sin(segment.midAngle) * labelRadius;

      context.shadowColor = 'rgba(15, 23, 42, 0.32)';
      context.shadowBlur = 6;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = 1;
      context.fillStyle = this.getSegmentLabelColor(segment.color);
      context.fillText(label, x, y);
    }

    context.restore();
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

  private canRenderSegmentLabel(
    context: Pick<SKRSContext2D, 'measureText'>,
    label: string,
    segment: Pick<ChartSegmentLayout, 'share' | 'sweep'>,
    radius: number,
  ) {
    if (segment.share < 0.08) {
      return false;
    }

    const availableArcLength = radius * segment.sweep;
    const labelWidth = context.measureText(label).width;
    return labelWidth <= availableArcLength * 0.82;
  }

  private getSegmentLabelColor(color: string) {
    const normalized = color.replace('#', '');
    if (normalized.length !== 6) {
      return '#ffffff';
    }

    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.72 ? '#0f172a' : '#ffffff';
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
