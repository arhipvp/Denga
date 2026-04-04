import { CategoryType } from '@prisma/client';
import { ClarificationService } from '../src/modules/telegram/clarification.service';
import { DraftLifecycleService } from '../src/modules/telegram/draft-lifecycle.service';
import { AiParsingService } from '../src/modules/telegram/services/ai-parsing.service';
import { TelegramDraftService } from '../src/modules/telegram/telegram-draft.service';

describe('ClarificationService category picker', () => {
  const telegramAccountFindUnique = jest.fn();
  const pendingFindFirst = jest.fn();
  const pendingUpdate = jest.fn();
  const categoryFindUnique = jest.fn();
  const categoryFindMany = jest.fn();
  const loadDraft = jest.fn();
  const updateDraftField = jest.fn();
  const sendTelegramMessage = jest.fn();
  const editTelegramMessage = jest.fn();
  const answerCallbackQuery = jest.fn();

  const service = new ClarificationService(
    {
      telegramAccount: {
        findUnique: telegramAccountFindUnique,
      },
      pendingOperationReview: {
        findFirst: pendingFindFirst,
        update: pendingUpdate,
      },
      category: {
        findUnique: categoryFindUnique,
        findMany: categoryFindMany,
      },
    } as never,
    {
      getHouseholdId: jest.fn().mockReturnValue('household-1'),
    } as never,
    {
      loadDraft,
      confirmDraft: jest.fn(),
      cancelDraft: jest.fn(),
      renderDraftCard: jest.fn(),
    } as never,
    {
      sendTelegramMessage,
      editTelegramMessage,
      answerCallbackQuery,
    } as never,
    {
      normalizeDate: jest.fn(),
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    telegramAccountFindUnique.mockResolvedValue({
      user: { id: 'user-1' },
    });
    pendingFindFirst.mockResolvedValue({
      id: 'draft-1',
    });
    loadDraft.mockResolvedValue({
      type: 'expense',
    });
    categoryFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({
      id,
      name: `Категория ${id}`,
    }));
    updateDraftField.mockResolvedValue({ accepted: true, status: 'pending_review' });
    jest.spyOn(service, 'updateDraftField').mockImplementation(updateDraftField);
  });

  it('shows the first page of matching categories with forward navigation', async () => {
    categoryFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `expense-${index + 1}`,
        name: `Расход ${String(index + 1).padStart(2, '0')}`,
        type: CategoryType.EXPENSE,
        isActive: true,
      })),
    );

    await expect(service.beginFieldEdit('draft-1', 'category', 'chat-1')).resolves.toEqual({
      accepted: true,
      status: 'editing_category',
    });

    expect(categoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: 'household-1',
          isActive: true,
          type: CategoryType.EXPENSE,
        }),
      }),
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'Выберите категорию (страница 1/2):',
      {
        inline_keyboard: [
          [{ text: 'Расход 01', callback_data: 'draft:set-category:expense-1' }],
          [{ text: 'Расход 02', callback_data: 'draft:set-category:expense-2' }],
          [{ text: 'Расход 03', callback_data: 'draft:set-category:expense-3' }],
          [{ text: 'Расход 04', callback_data: 'draft:set-category:expense-4' }],
          [{ text: 'Расход 05', callback_data: 'draft:set-category:expense-5' }],
          [{ text: 'Расход 06', callback_data: 'draft:set-category:expense-6' }],
          [{ text: 'Расход 07', callback_data: 'draft:set-category:expense-7' }],
          [{ text: 'Расход 08', callback_data: 'draft:set-category:expense-8' }],
          [{ text: 'Вперед', callback_data: 'draft:category-page:1' }],
        ],
      },
    );
  });

  it('paginates categories by editing the existing message', async () => {
    categoryFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `expense-${index + 1}`,
        name: `Расход ${String(index + 1).padStart(2, '0')}`,
        type: CategoryType.EXPENSE,
        isActive: true,
      })),
    );

    await expect(
      service.handleCallbackQuery({
        id: 'callback-1',
        data: 'draft:category-page:1',
        from: { id: 'telegram-user-1' },
        message: {
          message_id: 55,
          chat: { id: 'chat-1' },
        },
      }),
    ).resolves.toEqual({ accepted: true, status: 'editing_category' });

    expect(answerCallbackQuery).toHaveBeenCalledWith('callback-1');
    expect(editTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      55,
      'Выберите категорию (страница 2/2):',
      {
        inline_keyboard: [
          [{ text: 'Расход 09', callback_data: 'draft:set-category:expense-9' }],
          [{ text: 'Расход 10', callback_data: 'draft:set-category:expense-10' }],
          [{ text: 'Назад', callback_data: 'draft:category-page:0' }],
        ],
      },
    );
  });

  it('keeps category selection working after pagination callbacks', async () => {
    await expect(
      service.handleCallbackQuery({
        id: 'callback-2',
        data: 'draft:set-category:expense-9',
        from: { id: 'telegram-user-1' },
        message: {
          message_id: 55,
          chat: { id: 'chat-1' },
        },
      }),
    ).resolves.toEqual({ accepted: true, status: 'pending_review' });

    expect(updateDraftField).toHaveBeenCalledWith(
      'draft-1',
      { categoryId: 'expense-9', categoryName: 'Категория expense-9' },
      'chat-1',
    );
  });

  it('shows an explicit message when no active categories are available', async () => {
    categoryFindMany.mockResolvedValue([]);

    await expect(service.beginFieldEdit('draft-1', 'category', 'chat-1')).resolves.toEqual({
      accepted: true,
      status: 'editing_category_empty',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'Нет активных категорий для выбранного типа операции.',
    );
  });
});

describe('DraftLifecycleService clarification flow', () => {
  const findUniqueOrThrow = jest.fn();
  const pendingCreate = jest.fn();
  const pendingUpdate = jest.fn();
  const sourceMessageUpdate = jest.fn();
  const parseAttemptCreate = jest.fn();
  const parseTransaction = jest.fn();

  const draftService = new TelegramDraftService();
  const aiParsingServiceMock = {
    parseTransaction,
    buildPromptSnapshot: AiParsingService.prototype.buildPromptSnapshot,
    buildRuntimeSystemPrompt: (AiParsingService.prototype as any).buildRuntimeSystemPrompt,
    buildUserMessage: (AiParsingService.prototype as any).buildUserMessage,
  };
  const service = new DraftLifecycleService(
    {
      pendingOperationReview: {
        findUniqueOrThrow,
        create: pendingCreate,
        update: pendingUpdate,
      },
      sourceMessage: {
        update: sourceMessageUpdate,
      },
      aiParseAttempt: {
        create: parseAttemptCreate,
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
    aiParsingServiceMock as never,
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
    jest.spyOn(service, 'renderDraftCard').mockResolvedValue(undefined);
  });

  it('merges follow-up clarification into existing draft and stores categories in runtime system prompt', async () => {
    jest.spyOn(service, 'loadActiveCategories').mockResolvedValue([
      { id: 'cat-1', name: 'Транспорт', type: CategoryType.EXPENSE },
      { id: 'cat-2', name: 'Продукты', type: CategoryType.EXPENSE },
      { id: 'cat-3', name: 'Зарплата', type: CategoryType.INCOME },
    ]);
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

    expect(parseTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: ['Транспорт', 'Продукты', 'Зарплата'],
      }),
    );
    expect(pendingUpdate).toHaveBeenCalledWith(
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
    expect(parseAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: expect.any(String),
        }),
      }),
    );

    const promptSnapshot = JSON.parse(parseAttemptCreate.mock.calls[0][0].data.prompt) as {
      systemPrompt: string;
      userMessage: string;
      categories: string[];
    };

    expect(promptSnapshot.systemPrompt).toContain('parse');
    expect(promptSnapshot.systemPrompt).toContain(
      'Доступные категории: Транспорт, Продукты, Зарплата.',
    );
    expect(promptSnapshot.systemPrompt).toContain(
      'Правила: categoryCandidate должен быть только одним точным значением из списка доступных категорий или null.',
    );
    expect(promptSnapshot.categories).toEqual(['Транспорт', 'Продукты', 'Зарплата']);
    expect(promptSnapshot.userMessage).not.toContain('Доступные категории:');
    expect(promptSnapshot.userMessage).toContain('Текущее сообщение пользователя:\n18 евро на такси');
  });
});
