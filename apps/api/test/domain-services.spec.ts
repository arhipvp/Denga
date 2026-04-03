import { CategoryType, SourceMessageStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CategoryService } from '../src/modules/category/category.service';
import { HouseholdContextService } from '../src/modules/common/household-context.service';
import { TransactionCoreService } from '../src/modules/transaction/transaction-core.service';
import { TransactionService } from '../src/modules/transaction/transaction.service';

describe('CategoryService', () => {
  const create = jest.fn();
  const update = jest.fn();
  const service = new CategoryService({ category: { create, update } } as never);

  beforeEach(() => {
    jest.clearAllMocks();
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
  const categoryFindUniqueOrThrow = jest.fn();
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
      },
      category: {
        findUniqueOrThrow: categoryFindUniqueOrThrow,
      },
    } as never,
    settingsService as never,
    transactionCoreService,
    householdContext as HouseholdContextService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getSettings.mockResolvedValue({ defaultCurrency: 'EUR' });
  });

  it('creates manual transactions with validated category type', async () => {
    sourceMessageCreate.mockResolvedValue({ id: 'source-1' });
    categoryFindUniqueOrThrow.mockResolvedValue({ type: CategoryType.EXPENSE });
    transactionCreate.mockResolvedValue({ id: 'tx-1' });

    await service.createManual({
      type: 'expense',
      amount: 25.5,
      occurredAt: '2026-04-01T00:00:00.000Z',
      categoryId: 'cat-1',
      comment: 'Taxi',
    });

    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceMessageId: 'source-1',
          type: TransactionType.EXPENSE,
          currency: 'EUR',
          comment: 'Taxi',
        }),
      }),
    );
    expect(transactionCreate.mock.calls[0][0].data.amount).toBeInstanceOf(Decimal);
  });

  it('updates existing transactions', async () => {
    transactionFindUniqueOrThrow.mockResolvedValue({
      id: 'tx-1',
      type: TransactionType.EXPENSE,
      categoryId: 'cat-1',
    });
    categoryFindUniqueOrThrow.mockResolvedValue({ type: CategoryType.EXPENSE });
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
    transactionUpdate.mockResolvedValue({});

    await expect(service.cancel('tx-1')).resolves.toEqual({ success: true });
    expect(transactionUpdate).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { status: 'CANCELLED' },
    });
  });
});
