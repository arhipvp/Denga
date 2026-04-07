import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  CurrentMonthCategoryBreakdown,
  CurrentMonthCategoryBreakdownItem,
  SummaryCalculationTransaction,
  SummaryCategoryItem,
  TransactionSummary,
} from './transaction.types';

const UNCATEGORIZED_INCOME_KEY = 'uncategorized-income';
const UNCATEGORIZED_EXPENSE_KEY = 'uncategorized-expense';
const UNCATEGORIZED_LABEL = 'Без категории';

function buildMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildMonthKeys(now: Date, count = 6) {
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1 - index), 1),
    );

    return buildMonthKey(value);
  });
}

function createCategoryAccumulator(item: SummaryCalculationTransaction) {
  return {
    categoryId: item.parentCategoryId ?? item.categoryId,
    categoryName: item.parentCategoryName ?? item.categoryName ?? UNCATEGORIZED_LABEL,
    amount: 0,
  };
}

function buildTopCategories(
  items: Iterable<{ categoryId: string | null; categoryName: string; amount: number }>,
  total: number,
): SummaryCategoryItem[] {
  return Array.from(items)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      share: total > 0 ? item.amount / total : 0,
    }));
}

export function calculateTransactionSummary(
  transactions: SummaryCalculationTransaction[],
  now: Date,
): TransactionSummary {
  const currentPeriodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const nextPeriodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const previousPeriodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const monthKeys = buildMonthKeys(now);
  const monthlyMap = new Map(
    monthKeys.map((month) => [month, { month, income: 0, expense: 0, net: 0 }]),
  );
  const currentCategoryExpenseMap = new Map<
    string,
    { categoryId: string | null; categoryName: string; amount: number }
  >();
  const currentCategoryIncomeMap = new Map<
    string,
    { categoryId: string | null; categoryName: string; amount: number }
  >();
  const currentPeriodTotals = { income: 0, expense: 0, balance: 0 };
  const previousPeriodTotals = { income: 0, expense: 0, balance: 0 };
  const counts = { operations: 0, income: 0, expense: 0, cancelled: 0 };
  const averageAccumulator = {
    incomeTotal: 0,
    incomeCount: 0,
    expenseTotal: 0,
    expenseCount: 0,
    total: 0,
    totalCount: 0,
  };

  for (const item of transactions) {
    const month = buildMonthKey(item.occurredAt);

    if (item.status === TransactionStatus.CONFIRMED) {
      const monthlyEntry = monthlyMap.get(month);
      if (monthlyEntry) {
        if (item.type === TransactionType.INCOME) {
          monthlyEntry.income += item.amount;
          monthlyEntry.net += item.amount;
        } else {
          monthlyEntry.expense += item.amount;
          monthlyEntry.net -= item.amount;
        }
      }
    }

    const isCurrentPeriod =
      item.occurredAt >= currentPeriodStart && item.occurredAt < nextPeriodStart;
    const isPreviousPeriod =
      item.occurredAt >= previousPeriodStart && item.occurredAt < currentPeriodStart;

    if (item.status === TransactionStatus.CANCELLED && isCurrentPeriod) {
      counts.cancelled += 1;
    }

    if (item.status !== TransactionStatus.CONFIRMED) {
      continue;
    }

    if (isCurrentPeriod) {
      counts.operations += 1;
      averageAccumulator.total += item.amount;
      averageAccumulator.totalCount += 1;

      if (item.type === TransactionType.INCOME) {
        counts.income += 1;
        currentPeriodTotals.income += item.amount;
        currentPeriodTotals.balance += item.amount;
        averageAccumulator.incomeTotal += item.amount;
        averageAccumulator.incomeCount += 1;

        const key = item.parentCategoryId ?? item.categoryId ?? UNCATEGORIZED_INCOME_KEY;
        const current =
          currentCategoryIncomeMap.get(key) ?? createCategoryAccumulator(item);
        current.amount += item.amount;
        currentCategoryIncomeMap.set(key, current);
      } else {
        counts.expense += 1;
        currentPeriodTotals.expense += item.amount;
        currentPeriodTotals.balance -= item.amount;
        averageAccumulator.expenseTotal += item.amount;
        averageAccumulator.expenseCount += 1;

        const key = item.parentCategoryId ?? item.categoryId ?? UNCATEGORIZED_EXPENSE_KEY;
        const current =
          currentCategoryExpenseMap.get(key) ?? createCategoryAccumulator(item);
        current.amount += item.amount;
        currentCategoryExpenseMap.set(key, current);
      }
    }

    if (isPreviousPeriod) {
      if (item.type === TransactionType.INCOME) {
        previousPeriodTotals.income += item.amount;
        previousPeriodTotals.balance += item.amount;
      } else {
        previousPeriodTotals.expense += item.amount;
        previousPeriodTotals.balance -= item.amount;
      }
    }
  }

  return {
    totals: {
      currentPeriod: currentPeriodTotals,
      previousPeriod: previousPeriodTotals,
    },
    diffs: {
      income: currentPeriodTotals.income - previousPeriodTotals.income,
      expense: currentPeriodTotals.expense - previousPeriodTotals.expense,
      balance: currentPeriodTotals.balance - previousPeriodTotals.balance,
    },
    counts,
    average: {
      income:
        averageAccumulator.incomeCount > 0
          ? averageAccumulator.incomeTotal / averageAccumulator.incomeCount
          : 0,
      expense:
        averageAccumulator.expenseCount > 0
          ? averageAccumulator.expenseTotal / averageAccumulator.expenseCount
          : 0,
      transaction:
        averageAccumulator.totalCount > 0
          ? averageAccumulator.total / averageAccumulator.totalCount
          : 0,
    },
    topExpenseCategories: buildTopCategories(
      currentCategoryExpenseMap.values(),
      currentPeriodTotals.expense,
    ),
    topIncomeCategories: buildTopCategories(
      currentCategoryIncomeMap.values(),
      currentPeriodTotals.income,
    ),
    monthly: Array.from(monthlyMap.values()),
  };
}

export function calculateCurrentMonthCategoryBreakdown(input: {
  transactions: SummaryCalculationTransaction[];
  periodStart: Date;
  currency: string;
  minimumVisibleShare?: number;
}): CurrentMonthCategoryBreakdown {
  const totalAmount = input.transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const categoryMap = new Map<
    string,
    { categoryId: string | null; categoryName: string; amount: number }
  >();

  for (const item of input.transactions) {
    const key = item.parentCategoryId ?? item.categoryId ?? UNCATEGORIZED_EXPENSE_KEY;
    const current = categoryMap.get(key) ?? createCategoryAccumulator(item);
    current.amount += item.amount;
    categoryMap.set(key, current);
  }

  const sortedItems: CurrentMonthCategoryBreakdownItem[] = Array.from(categoryMap.values())
    .sort((left, right) => right.amount - left.amount)
    .map((item) => ({
      ...item,
      share: totalAmount > 0 ? item.amount / totalAmount : 0,
    }));
  const fullItems = sortedItems.map((item) => ({ ...item }));
  const minimumVisibleShare = input.minimumVisibleShare ?? 0.05;
  const visibleItems = sortedItems.filter((item) => item.share >= minimumVisibleShare);
  const hiddenItems = sortedItems.filter((item) => item.share < minimumVisibleShare);

  if (hiddenItems.length > 0) {
    const otherAmount = hiddenItems.reduce((sum, item) => sum + item.amount, 0);
    visibleItems.push({
      categoryId: null,
      categoryName: 'Прочие категории',
      amount: otherAmount,
      share: totalAmount > 0 ? otherAmount / totalAmount : 0,
      isOther: true,
    });
  }

  visibleItems.sort((left, right) => right.amount - left.amount);

  return {
    periodLabel: formatCurrentMonthLabel(input.periodStart),
    currency: input.currency,
    totalAmount,
    items: visibleItems,
    fullItems,
  };
}

export function formatCurrentMonthLabel(date: Date) {
  const month = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date);

  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getUTCFullYear()}`;
}
