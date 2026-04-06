import { TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TransactionNotificationService } from '../src/modules/telegram/transaction-notification.service';

describe('TransactionNotificationService', () => {
  const transactionFindFirst = jest.fn();
  const telegramAccountFindMany = jest.fn();
  const sendTelegramMessage = jest.fn();

  const service = new TransactionNotificationService(
    {
      transaction: {
        findFirst: transactionFindFirst,
      },
      telegramAccount: {
        findMany: telegramAccountFindMany,
      },
    } as never,
    {
      getHouseholdId: jest.fn().mockReturnValue('household-1'),
    } as never,
    {
      sendTelegramMessage,
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends notifications to unique active telegram recipients', async () => {
    transactionFindFirst.mockResolvedValue({
      id: 'tx-1',
      type: TransactionType.EXPENSE,
      amount: new Decimal(25.5),
      currency: 'EUR',
      occurredAt: new Date('2026-04-06T00:00:00.000Z'),
      comment: 'Такси',
      category: { name: 'Транспорт' },
      author: { displayName: 'Алексей' },
    });
    telegramAccountFindMany.mockResolvedValue([
      { telegramId: '111' },
      { telegramId: '222' },
      { telegramId: '111' },
      { telegramId: ' 222 ' },
    ]);
    sendTelegramMessage.mockResolvedValue({ message_id: 1 });

    await expect(service.notifyTransactionCreated('tx-1')).resolves.toEqual({
      recipients: 2,
      delivered: 2,
      failed: 0,
    });

    expect(telegramAccountFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          user: {
            householdId: 'household-1',
          },
        },
      }),
    );
    expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(sendTelegramMessage).toHaveBeenNthCalledWith(
      1,
      '111',
      expect.stringContaining('Добавлена новая операция'),
    );
    expect(sendTelegramMessage).toHaveBeenNthCalledWith(
      2,
      '222',
      expect.stringContaining('Автор: Алексей'),
    );
  });

  it('swallows delivery failures and reports counts', async () => {
    transactionFindFirst.mockResolvedValue({
      id: 'tx-1',
      type: TransactionType.INCOME,
      amount: new Decimal(100),
      currency: 'EUR',
      occurredAt: new Date('2026-04-06T00:00:00.000Z'),
      comment: null,
      category: { name: 'Зарплата' },
      author: null,
    });
    telegramAccountFindMany.mockResolvedValue([{ telegramId: '111' }, { telegramId: '222' }]);
    sendTelegramMessage
      .mockRejectedValueOnce(new Error('telegram failed'))
      .mockResolvedValueOnce({ message_id: 2 });

    await expect(service.notifyTransactionCreated('tx-1')).resolves.toEqual({
      recipients: 2,
      delivered: 1,
      failed: 1,
    });
  });

  it('skips cleanly when there are no active recipients', async () => {
    transactionFindFirst.mockResolvedValue({
      id: 'tx-1',
      type: TransactionType.EXPENSE,
      amount: new Decimal(10),
      currency: 'EUR',
      occurredAt: new Date('2026-04-06T00:00:00.000Z'),
      comment: null,
      category: null,
      author: null,
    });
    telegramAccountFindMany.mockResolvedValue([]);

    await expect(service.notifyTransactionCreated('tx-1')).resolves.toEqual({
      recipients: 0,
      delivered: 0,
      failed: 0,
    });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
