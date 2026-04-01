import { CategoryType } from '@prisma/client';
import { TelegramService } from '../src/modules/telegram/telegram.service';

describe('TelegramService clarification flow', () => {
  const findUniqueOrThrow = jest.fn();
  const update = jest.fn();
  const parseTransaction = jest.fn();

  const service = new TelegramService(
    {
      pendingOperationReview: {
        findUniqueOrThrow,
        update,
      },
    } as never,
    {
      getSettings: jest.fn().mockResolvedValue({
        aiModel: 'model',
        parsingPrompt: 'parse',
        clarificationPrompt: 'clarify',
        defaultCurrency: 'EUR',
      }),
    } as never,
    {
      parseTransaction,
    } as never,
    {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).loadActiveCategories = jest.fn().mockResolvedValue([
      { id: 'cat-1', name: 'Транспорт', type: CategoryType.EXPENSE },
    ]);
    (service as any).renderDraftCard = jest.fn().mockResolvedValue(undefined);
    (service as any).recordParseAttempt = jest.fn().mockResolvedValue(undefined);
  });

  it('merges follow-up clarification into existing draft', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      sourceMessageId: 'source-1',
      draft: {
        type: null,
        amount: null,
        occurredAt: '2026-04-01T00:00:00.000Z',
        categoryId: null,
        categoryName: null,
        comment: 'Старый черновик',
        currency: 'EUR',
        confidence: 0.2,
        ambiguities: ['amount', 'category'],
        followUpQuestion: 'Сколько и на что?',
        sourceText: 'черновик',
      },
      sourceMessage: {
        attachments: [],
        parseAttempts: [],
      },
    });
    parseTransaction.mockResolvedValue({
      type: 'expense',
      amount: 18,
      occurredAt: '2026-04-01',
      categoryCandidate: 'Транспорт',
      comment: null,
      confidence: 0.9,
      ambiguities: [],
      followUpQuestion: null,
      resolvedCurrency: null,
    });

    await expect(
      (service as any).reparseExistingDraft('draft-1', '18 евро на такси', 'chat-1'),
    ).resolves.toEqual({ accepted: true, status: 'pending_review' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: expect.objectContaining({
          pendingField: null,
          draft: expect.objectContaining({
            type: 'expense',
            amount: 18,
            categoryId: 'cat-1',
            categoryName: 'Транспорт',
          }),
        }),
      }),
    );
  });
});
