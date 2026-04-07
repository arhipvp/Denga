import { format } from 'date-fns';

type MoneyOptions = {
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

function normalizeAmount(value: number | string) {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number | string, options: MoneyOptions = {}) {
  const amount = normalizeAmount(value);
  const formatted = amount.toLocaleString('ru-RU', {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  });

  return options.currency ? `${formatted} ${options.currency}` : formatted;
}

export function formatSignedMoney(value: number | string, options: MoneyOptions = {}) {
  const amount = normalizeAmount(value);
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatMoney(Math.abs(amount), options)}`;
}

export function formatDate(value: string | Date, includeTime = false) {
  return format(new Date(value), includeTime ? 'dd.MM.yyyy HH:mm:ss' : 'dd.MM.yyyy');
}

export function formatMonthLabel(month: string) {
  const [year, value] = month.split('-').map(Number);
  const labels = [
    'Янв',
    'Фев',
    'Мар',
    'Апр',
    'Май',
    'Июн',
    'Июл',
    'Авг',
    'Сен',
    'Окт',
    'Ноя',
    'Дек',
  ];

  return `${labels[(value ?? 1) - 1]} ${year}`;
}

export function formatShare(share: number) {
  return `${(share * 100).toFixed(0)}%`;
}
