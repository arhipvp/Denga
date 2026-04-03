import { CategoryType } from '@prisma/client';
import { DraftLifecycleService } from '../src/modules/telegram/draft-lifecycle.service';
import { TelegramDraftService } from '../src/modules/telegram/telegram-draft.service';

describe('DraftLifecycleService clarification flow', () => {
  const findUniqueOrThrow = jest.fn();
  const update = jest.fn();
  const create = jest.fn();
  const parseTransaction = jest.fn();

  const draftService = new TelegramDraftService();
  const service = new DraftLifecycleService(
    {
      pendingOperationReview: {
        findUniqueOrThrow,
        update,
      },
      aiParseAttempt: {
        create,
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
    {
      getHouseholdId: jest.fn().mockReturnValue('household-1'),
    } as never,
    {
      buildAttachmentDataUrl: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      sendTelegramMessage: jest.fn(),
      editTelegramMessage: jest.fn(),
    } as never,
    draftService,
    {
      createConfirmedFromDraft: jest.fn(),
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'loadActiveCategories').mockResolvedValue([
      { id: 'cat-1', name: 'Транспорт', type: CategoryType.EXPENSE },
    ]);
    jest.spyOn(service, 'renderDraftCard').mockResolvedValue(undefined);
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
      service.reparseDraftWithClarification('draft-1', '18 евро на такси', 'chat-1'),
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
    expect(create).toHaveBeenCalled();
  });
});
