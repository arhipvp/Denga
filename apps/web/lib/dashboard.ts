import type { Section } from './types';

export const sectionLabels: Record<Section, string> = {
  overview: 'Обзор',
  operations: 'Операции',
  categories: 'Категории',
  users: 'Пользователи',
  settings: 'Настройки',
  logs: 'Логи',
};

export function formatTransactionTypeLabel(
  type: 'INCOME' | 'EXPENSE' | 'income' | 'expense' | null,
) {
  if (type === 'INCOME' || type === 'income') {
    return 'Доход';
  }

  if (type === 'EXPENSE' || type === 'expense') {
    return 'Расход';
  }

  return 'Не определено';
}

export function formatTransactionStatusLabel(
  status:
    | 'CONFIRMED'
    | 'NEEDS_CLARIFICATION'
    | 'CANCELLED'
    | 'confirmed'
    | 'cancelled',
) {
  if (status === 'CONFIRMED' || status === 'confirmed') {
    return 'Подтверждена';
  }

  if (status === 'NEEDS_CLARIFICATION') {
    return 'Нужно уточнение';
  }

  return 'Отменена';
}

export function formatCategoryStatusLabel(isActive: boolean) {
  return isActive ? 'Активна' : 'Отключена';
}
