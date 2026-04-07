import {
  CategoryType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CategoryService } from '../src/modules/category/category.service';
import { HouseholdContextService } from '../src/modules/common/household-context.service';
import { TransactionCoreService } from '../src/modules/transaction/transaction-core.service';
import { TransactionService } from '../src/modules/transaction/transaction.service';

describe('CategoryService', () => {
  const create = jest.fn();
  const update = jest.fn();
  const findFirst = jest.fn();
  const findUnique = jest.fn();
  const service = new CategoryService({
    category: { create, update, findFirst, findUnique },
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: 'cat-1',
      householdId: 'bootstrap-household',
      children: [],
    });
  });

  it('creates categories with mapped prisma type', async () => {
    create.mockResolvedValue({ id: 'cat-1' });

    await service.create({ name: 'Salary', type: 'income', isActive: true });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Salary',
          type: CategoryType.INCOME,
          isActive: true,
        }),
      }),
    );
  });

  it('soft-deletes categories by disabling them', async () => {
    update.mockResolvedValue({});

    await expect(service.remove('cat-1')).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { isActive: false },
    });
  });
});

describe('TransactionService', () => {
  const sourceMessageCreate = jest.fn();
  const transactionCreate = jest.fn();
  const transactionUpdate = jest.fn();
  const transactionFindUniqueOrThrow = jest.fn();
  const transactionFindMany = jest.fn();
  const transactionCount = jest.fn();
  const categoryFindUniqueOrThrow = jest.fn();
  const notifyTransactionCreated = jest.fn();
  const notifyTransactionDeleted = jest.fn();
  const settingsService = {
    getSettings: jest.fn().mockResolvedValue({ defaultCurrency: 'EUR' }),
  };
  const householdContext = {
    getHouseholdId: jest.fn().mockReturnValue('household-1'),
  };
  const transactionCoreService = new TransactionCoreService(
    {
      category: {
        findUniqueOrThrow: categoryFindUniqueOrThrow,
      },
      transaction: {
        create: transactionCreate,
      },
      sourceMessage: {
        update: jest.fn(),
      },
      pendingOperationReview: {
        update: jest.fn(),
      },
    } as never,
    settingsService as never,
    householdContext as HouseholdContextService,
  );

  const service = new TransactionService(
    {
      sourceMessage: { create: sourceMessageCreate },
      transaction: {
        create: transactionCreate,
        update: transactionUpdate,
        findUniqueOrThrow: transactionFindUniqueOrThrow,
        findMany: transactionFindMany,
        count: transactionCount,
      },
      category: {
        findUniqueOrThrow: categoryFindUniqueOrThrow,
      },
    } as never,
    settingsService as never,
    transactionCoreService,
    householdContext as HouseholdContextService,
    {
      notifyTransactionCreated,
      notifyTransactionDeleted,
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getSettings.mockResolvedValue({ defaultCurrency: 'EUR' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createTransaction(input: {
    id: string;
    amount: number;
    occurredAt: string;
    type: TransactionType;
    status?: TransactionStatus;
    categoryId?: string | null;
    categoryName?: string | null;
    comment?: string | null;
  }) {
    return {
      id: input.id,
      householdId: 'household-1',
      authorId: null,
      categoryId: input.categoryId ?? null,
      sourceMessageId: null,
      type: input.type,
      amount: new Decimal(input.amount),
      currency: 'EUR',
      occurredAt: new Date(input.occurredAt),
      comment: input.comment ?? null,
      status: input.status ?? TransactionStatus.CONFIRMED,
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
      author: null,
      category:
        input.categoryId === undefined && input.categoryName === undefined
          ? null
          : {
              id: input.categoryId ?? `${input.id}-category`,
              householdId: 'household-1',
              name: input.categoryName ?? 'Без категории',
              type:
                input.type === TransactionType.INCOME
                  ? CategoryType.INCOME
                  : CategoryType.EXPENSE,
              isActive: true,
              createdAt: new Date(input.occurredAt),
              updatedAt: new Date(input.occurredAt),
            },
      sourceMessage: null,
    };
  }

  it('creates manual transactions with validated category type', async () => {
    sourceMessageCreate.mockResolvedValue({ id: 'source-1' });
    categoryFindUniqueOrThrow.mockResolvedValue({
      type: CategoryType.EXPENSE,
      parentId: 'parent-1',
    });
    transactionCreate.mockResolvedValue({ id: 'tx-1' });

    await service.createManual(
      {
        type: 'expense',
        amount: 25.5,
        occurredAt: '2026-04-01T00:00:00.000Z',
        categoryId: 'cat-1',
        comment: 'Taxi',
      },
      'user-1',
    );

    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorId: 'user-1',
          sourceMessageId: 'source-1',
          type: TransactionType.EXPENSE,
          currency: 'EUR',
          comment: 'Taxi',
        }),
      }),
    );
    expect(sourceMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorId: 'user-1',
        }),
      }),
    );
    expect(notifyTransactionCreated).toHaveBeenCalledWith('tx-1');
    expect(transactionCreate.mock.calls[0][0].data.amount).toBeInstanceOf(Decimal);
  });

  it('updates existing transactions', async () => {
    transactionFindUniqueOrThrow.mockResolvedValue({
      id: 'tx-1',
      type: TransactionType.EXPENSE,
      categoryId: 'cat-1',
    });
    categoryFindUniqueOrThrow.mockResolvedValue({
      type: CategoryType.EXPENSE,
      parentId: 'parent-1',
    });
    transactionUpdate.mockResolvedValue({ id: 'tx-1' });

    await service.update('tx-1', {
      amount: 30,
      comment: 'Updated',
      status: 'cancelled',
    });

    expect(transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx-1' },
        data: expect.objectContaining({
          comment: 'Updated',
          amount: expect.any(Decimal),
          status: 'CANCELLED',
        }),
      }),
    );
  });

  it('cancels transactions explicitly', async () => {
    transactionUpdate.mockResolvedValue({ id: 'tx-1' });

    await expect(service.cancel('tx-1')).resolves.toEqual({ success: true });
    expect(transactionUpdate).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'CANCELLED' },
      include: {
        category: true,
        author: true,
      },
    });
    expect(notifyTransactionDeleted).toHaveBeenCalledWith('tx-1');
  });

  it('lists transactions with search, sorting and pagination metadata', async () => {
    transactionFindMany.mockResolvedValue([{ id: 'tx-2' }]);
    transactionCount.mockResolvedValue(7);

    const payload = await service.list({
      status: 'confirmed',
      type: 'expense',
      search: 'такси',
      sortBy: 'amount',
      sortDir: 'asc',
      page: 2,
      pageSize: 3,
    });

    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: 'household-1',
          status: TransactionStatus.CONFIRMED,
          type: TransactionType.EXPENSE,
          OR: expect.any(Array),
        }),
        orderBy: [{ amount: 'asc' }, { occurredAt: 'desc' }],
        skip: 3,
        take: 3,
      }),
    );
    expect(transactionCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        householdId: 'household-1',
        status: TransactionStatus.CONFIRMED,
        type: TransactionType.EXPENSE,
      }),
    });
    expect(payload).toEqual({
      items: [{ id: 'tx-2' }],
      total: 7,
      page: 2,
      pageSize: 3,
    });
  });

  it('returns empty summary when there are no transactions', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    transactionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const summary = await service.summary();

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
      recent: [],
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

  it('builds income-only summary for the current month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    const recentTransactions = [
      createTransaction({
        id: 'tx-2',
        amount: 500,
        occurredAt: '2026-04-10T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'salary',
        categoryName: 'Зарплата',
      }),
      createTransaction({
        id: 'tx-1',
        amount: 1000,
        occurredAt: '2026-04-05T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'freelance',
        categoryName: 'Фриланс',
      }),
    ];

    transactionFindMany
      .mockResolvedValueOnce(recentTransactions)
      .mockResolvedValueOnce([...recentTransactions].reverse());

    const summary = await service.summary();

    expect(summary.totals.currentPeriod).toEqual({
      income: 1500,
      expense: 0,
      balance: 1500,
    });
    expect(summary.counts).toEqual({
      operations: 2,
      income: 2,
      expense: 0,
      cancelled: 0,
    });
    expect(summary.average).toEqual({
      income: 750,
      expense: 0,
      transaction: 750,
    });
    expect(summary.topIncomeCategories).toEqual([
      expect.objectContaining({ categoryName: 'Фриланс', amount: 1000, share: 1000 / 1500 }),
      expect.objectContaining({ categoryName: 'Зарплата', amount: 500, share: 500 / 1500 }),
    ]);
    expect(summary.topExpenseCategories).toEqual([]);
  });

  it('builds expense-only summary for the current month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    const recentTransactions = [
      createTransaction({
        id: 'tx-2',
        amount: 60,
        occurredAt: '2026-04-07T12:00:00.000Z',
        type: TransactionType.EXPENSE,
        categoryId: 'food',
        categoryName: 'Еда',
      }),
      createTransaction({
        id: 'tx-1',
        amount: 40,
        occurredAt: '2026-04-03T12:00:00.000Z',
        type: TransactionType.EXPENSE,
        categoryId: 'taxi',
        categoryName: 'Такси',
      }),
    ];

    transactionFindMany
      .mockResolvedValueOnce(recentTransactions)
      .mockResolvedValueOnce([...recentTransactions].reverse());

    const summary = await service.summary();

    expect(summary.totals.currentPeriod).toEqual({
      income: 0,
      expense: 100,
      balance: -100,
    });
    expect(summary.average).toEqual({
      income: 0,
      expense: 50,
      transaction: 50,
    });
    expect(summary.topExpenseCategories).toEqual([
      expect.objectContaining({ categoryName: 'Еда', amount: 60, share: 0.6 }),
      expect.objectContaining({ categoryName: 'Такси', amount: 40, share: 0.4 }),
    ]);
    expect(summary.topIncomeCategories).toEqual([]);
  });

  it('calculates diffs, category shares and monthly buckets with gaps', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    const recentTransactions = [
      createTransaction({
        id: 'tx-recent-cancelled',
        amount: 30,
        occurredAt: '2026-04-16T12:00:00.000Z',
        type: TransactionType.EXPENSE,
        status: TransactionStatus.CANCELLED,
        categoryId: 'taxi',
        categoryName: 'Такси',
        comment: 'Отмена',
      }),
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
        comment: 'Супермаркет',
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
    ];
    const allTransactions = [
      ...recentTransactions,
      createTransaction({
        id: 'tx-january-income',
        amount: 200,
        occurredAt: '2026-01-09T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'bonus',
        categoryName: 'Бонус',
      }),
    ];

    transactionFindMany
      .mockResolvedValueOnce(recentTransactions)
      .mockResolvedValueOnce([...allTransactions].reverse());

    const summary = await service.summary();

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
    expect(summary.recent[0]).toMatchObject({
      id: 'tx-recent-cancelled',
      status: TransactionStatus.CANCELLED,
      comment: 'Отмена',
    });
  });

  it('builds full current month expense breakdown and groups tiny categories into others', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    transactionFindMany.mockResolvedValue([
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
    ]);

    const breakdown = await service.getCurrentMonthExpenseBreakdown();

    expect(breakdown.periodLabel).toBe('Апрель 2026');
    expect(breakdown.currency).toBe('EUR');
    expect(breakdown.totalAmount).toBe(192);
    expect(breakdown.fullItems).toEqual([
      expect.objectContaining({ categoryName: 'Еда', amount: 120, share: 120 / 192 }),
      expect.objectContaining({ categoryName: 'Такси', amount: 60, share: 60 / 192 }),
      expect.objectContaining({ categoryName: 'Кофе', amount: 8, share: 8 / 192 }),
      expect.objectContaining({ categoryName: 'Комиссии', amount: 4, share: 4 / 192 }),
    ]);
    expect(breakdown.items).toEqual([
      expect.objectContaining({ categoryName: 'Еда', amount: 120 }),
      expect.objectContaining({ categoryName: 'Такси', amount: 60 }),
      expect.objectContaining({
        categoryName: 'Прочие категории',
        amount: 12,
        isOther: true,
      }),
    ]);
    expect(breakdown.items[2].share).toBeCloseTo(12 / 192, 5);
  });

  it('returns an empty current month expense breakdown when there are no expenses', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    transactionFindMany.mockResolvedValue([]);

    const breakdown = await service.getCurrentMonthExpenseBreakdown();

    expect(breakdown).toEqual({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 0,
      items: [],
      fullItems: [],
    });
  });

  it('builds full current month income breakdown and groups tiny categories into others', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    transactionFindMany.mockResolvedValue([
      createTransaction({
        id: 'tx-salary',
        amount: 1500,
        occurredAt: '2026-04-12T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'salary',
        categoryName: 'Зарплата',
      }),
      createTransaction({
        id: 'tx-bonus',
        amount: 300,
        occurredAt: '2026-04-10T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'bonus',
        categoryName: 'Бонус',
      }),
      createTransaction({
        id: 'tx-cashback',
        amount: 40,
        occurredAt: '2026-04-08T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'cashback',
        categoryName: 'Кэшбэк',
      }),
      createTransaction({
        id: 'tx-refund',
        amount: 20,
        occurredAt: '2026-04-07T12:00:00.000Z',
        type: TransactionType.INCOME,
        categoryId: 'refund',
        categoryName: 'Возврат',
      }),
    ]);

    const breakdown = await service.getCurrentMonthIncomeBreakdown();

    expect(breakdown.periodLabel).toBe('Апрель 2026');
    expect(breakdown.currency).toBe('EUR');
    expect(breakdown.totalAmount).toBe(1860);
    expect(breakdown.fullItems).toEqual([
      expect.objectContaining({ categoryName: 'Зарплата', amount: 1500, share: 1500 / 1860 }),
      expect.objectContaining({ categoryName: 'Бонус', amount: 300, share: 300 / 1860 }),
      expect.objectContaining({ categoryName: 'Кэшбэк', amount: 40, share: 40 / 1860 }),
      expect.objectContaining({ categoryName: 'Возврат', amount: 20, share: 20 / 1860 }),
    ]);
    expect(breakdown.items).toEqual([
      expect.objectContaining({ categoryName: 'Зарплата', amount: 1500 }),
      expect.objectContaining({ categoryName: 'Бонус', amount: 300 }),
      expect.objectContaining({
        categoryName: 'Прочие категории',
        amount: 60,
        isOther: true,
      }),
    ]);
    expect(breakdown.items[2].share).toBeCloseTo(60 / 1860, 5);
  });
});
