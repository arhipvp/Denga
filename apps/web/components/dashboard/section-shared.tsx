'use client';

import {
  formatCategoryStatusLabel,
  formatTransactionStatusLabel,
  formatTransactionTypeLabel,
  getTransactionStatusBadgeClass,
  getTransactionTone,
} from '../../lib/dashboard';
import { formatMoney, formatSignedMoney } from '../../lib/formatters';

type MoneyTextProps = {
  value: number | string;
  currency: string;
  signed?: boolean;
  tone?: 'income' | 'expense' | 'balance' | 'neutral';
};

export function MoneyText({ value, currency, signed = false, tone = 'neutral' }: MoneyTextProps) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const resolvedTone =
    tone === 'balance'
      ? numeric > 0
        ? 'income'
        : numeric < 0
          ? 'expense'
          : 'neutral'
      : tone;

  return (
    <span className={`amount-text amount-text--${resolvedTone}`}>
      {signed ? formatSignedMoney(value, { currency }) : formatMoney(value, { currency })}
    </span>
  );
}

export function TransactionTypePill({
  type,
}: {
  type: 'INCOME' | 'EXPENSE' | 'income' | 'expense' | null;
}) {
  const tone = getTransactionTone(type);
  return <span className={`type-pill type-pill--${tone}`}>{formatTransactionTypeLabel(type)}</span>;
}

export function TransactionStatusBadge({
  status,
}: {
  status:
    | 'CONFIRMED'
    | 'NEEDS_CLARIFICATION'
    | 'CANCELLED'
    | 'confirmed'
    | 'cancelled';
}) {
  return <span className={getTransactionStatusBadgeClass(status)}>{formatTransactionStatusLabel(status)}</span>;
}

export function CategoryStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={isActive ? 'badge success' : 'badge danger'}>
      {formatCategoryStatusLabel(isActive)}
    </span>
  );
}
