import { TransactionStatus, TransactionType } from '@prisma/client';
import {
  calculateCurrentMonthExpenseBreakdown,
  calculateTransactionSummary,
} from '../src/modules/transaction/transaction-summary';
import type { SummaryCalculationTransaction } from '../src/modules/transaction/transaction.types';

function createTransaction(input: {
  id: string;
  amount: number;
  occurredAt: string;
  type: TransactionType;
  status?: TransactionStatus;
  categoryId?: string | null;
  categoryName?: string | null;
}): SummaryCalculationTransaction {
  return {
    id: input.id,
    type: input.type,
    status: input.status ?? TransactionStatus.CONFIRMED,
    amount: input.amount,
    occurredAt: new Date(input.occurredAt),
    categoryId: input.categoryId ?? null,
    categoryName: input.categoryName ?? null,
  };
}

describe('transaction summary calculator', () => {
  it('returns empty summary when there are no transactions', () => {
    const summary = calculateTransactionSummary([], new Date('2026-04-20T12:00:00.000Z'));

    expect(summary).toMatchObject({
      totals: {
        currentPeriod: { income: 0, expense: 0, balance: 0 },
        previousPeriod: { income: 0, expense: 0, balance: 0 },
      },
      diffs: { income: 0, expense: 0, balance: 0 },
      counts: { operations: 0, income: 0, expense: 0, cancelled: 0 },
      average: { income: 0, expense: 0, transaction: 0 },
      topExpenseCategories: [],
      topIncomeCategories: [],
    });
    expect(summary.monthly).toEqual([
      { month: '2025-11', income: 0, expense: 0, net: 0 },
      { month: '2025-12', income: 0, expense: 0, net: 0 },
      { month: '2026-01', income: 0, expense: 0, net: 0 },
      { month: '2026-02', income: 0, expense: 0, net: 0 },
      { month: '2026-03', income: 0, expense: 0, net: 0 },
      { month: '2026-04', income: 0, expense: 0, net: 0 },
    ]);
  });

  it('calculates diffs, counts, category shares and monthly buckets', () => {
    const summary = calculateTransactionSummary(
      [
        createTransaction({
          id: 'tx-current-income-1',
          amount: 400,
          occurredAt: '2026-04-15T12:00:00.000Z',
          type: TransactionType.INCOME,
          categoryId: 'salary',
          categoryName: 'Зарплата',
        }),
        createTransaction({
          id: 'tx-current-expense-1',
          amount: 120,
          occurredAt: '2026-04-12T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'food',
          categoryName: 'Еда',
        }),
        createTransaction({
          id: 'tx-current-expense-2',
          amount: 80,
          occurredAt: '2026-04-06T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'taxi',
          categoryName: 'Такси',
        }),
        createTransaction({
          id: 'tx-current-cancelled',
          amount: 30,
          occurredAt: '2026-04-16T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'taxi',
          categoryName: 'Такси',
          status: TransactionStatus.CANCELLED,
        }),
        createTransaction({
          id: 'tx-previous-income',
          amount: 300,
          occurredAt: '2026-03-11T12:00:00.000Z',
          type: TransactionType.INCOME,
          categoryId: 'salary',
          categoryName: 'Зарплата',
        }),
        createTransaction({
          id: 'tx-previous-expense',
          amount: 50,
          occurredAt: '2026-03-05T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'food',
          categoryName: 'Еда',
        }),
        createTransaction({
          id: 'tx-january-income',
          amount: 200,
          occurredAt: '2026-01-09T12:00:00.000Z',
          type: TransactionType.INCOME,
          categoryId: 'bonus',
          categoryName: 'Бонус',
        }),
      ],
      new Date('2026-04-20T12:00:00.000Z'),
    );

    expect(summary.totals).toEqual({
      currentPeriod: { income: 400, expense: 200, balance: 200 },
      previousPeriod: { income: 300, expense: 50, balance: 250 },
    });
    expect(summary.diffs).toEqual({
      income: 100,
      expense: 150,
      balance: -50,
    });
    expect(summary.counts).toEqual({
      operations: 3,
      income: 1,
      expense: 2,
      cancelled: 1,
    });
    expect(summary.average).toEqual({
      income: 400,
      expense: 100,
      transaction: 200,
    });
    expect(summary.topExpenseCategories).toEqual([
      expect.objectContaining({ categoryName: 'Еда', amount: 120, share: 0.6 }),
      expect.objectContaining({ categoryName: 'Такси', amount: 80, share: 0.4 }),
    ]);
    expect(summary.topIncomeCategories).toEqual([
      expect.objectContaining({ categoryName: 'Зарплата', amount: 400, share: 1 }),
    ]);
    expect(summary.monthly).toEqual([
      { month: '2025-11', income: 0, expense: 0, net: 0 },
      { month: '2025-12', income: 0, expense: 0, net: 0 },
      { month: '2026-01', income: 200, expense: 0, net: 200 },
      { month: '2026-02', income: 0, expense: 0, net: 0 },
      { month: '2026-03', income: 300, expense: 50, net: 250 },
      { month: '2026-04', income: 400, expense: 200, net: 200 },
    ]);
  });
});

describe('current month expense breakdown calculator', () => {
  it('groups tiny categories into others', () => {
    const breakdown = calculateCurrentMonthExpenseBreakdown({
      periodStart: new Date('2026-04-01T00:00:00.000Z'),
      currency: 'EUR',
      transactions: [
        createTransaction({
          id: 'tx-food',
          amount: 120,
          occurredAt: '2026-04-12T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'food',
          categoryName: 'Еда',
        }),
        createTransaction({
          id: 'tx-taxi',
          amount: 60,
          occurredAt: '2026-04-10T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'taxi',
          categoryName: 'Такси',
        }),
        createTransaction({
          id: 'tx-coffee',
          amount: 8,
          occurredAt: '2026-04-08T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'coffee',
          categoryName: 'Кофе',
        }),
        createTransaction({
          id: 'tx-fee',
          amount: 4,
          occurredAt: '2026-04-07T12:00:00.000Z',
          type: TransactionType.EXPENSE,
          categoryId: 'fee',
          categoryName: 'Комиссии',
        }),
      ],
    });

    expect(breakdown).toEqual({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 192,
      items: [
        expect.objectContaining({ categoryName: 'Еда', amount: 120 }),
        expect.objectContaining({ categoryName: 'Такси', amount: 60 }),
        expect.objectContaining({
          categoryName: 'Прочие категории',
          amount: 12,
          isOther: true,
        }),
      ],
    });
    expect(breakdown.items[2]?.share).toBeCloseTo(12 / 192, 5);
  });

  it('returns an empty current month expense breakdown when there are no expenses', () => {
    expect(
      calculateCurrentMonthExpenseBreakdown({
        periodStart: new Date('2026-04-01T00:00:00.000Z'),
        currency: 'EUR',
        transactions: [],
      }),
    ).toEqual({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 0,
      items: [],
    });
  });
});
