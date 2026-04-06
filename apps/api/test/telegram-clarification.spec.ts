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
  const clearDraftActivePicker = jest.fn();
  const setActivePickerMessage = jest.fn();
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
      clearDraftActivePicker,
      renderDraftCard: jest.fn(),
      setActivePickerMessage,
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
    clearDraftActivePicker.mockResolvedValue(undefined);
    setActivePickerMessage.mockResolvedValue(undefined);
    sendTelegramMessage.mockResolvedValue({ message_id: 77 });
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
    expect(clearDraftActivePicker).toHaveBeenCalledWith('draft-1', 'chat-1');
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
    expect(setActivePickerMessage).toHaveBeenCalledWith('draft-1', '77');
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
    expect(setActivePickerMessage).toHaveBeenCalledWith('draft-1', '55');
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

    expect(clearDraftActivePicker).toHaveBeenCalledWith('draft-1', 'chat-1', 55);
    expect(updateDraftField).toHaveBeenCalledWith(
      'draft-1',
      { categoryId: 'expense-9', categoryName: 'Категория expense-9' },
      'chat-1',
    );
  });

  it('cleans up the type picker before applying the selected type', async () => {
    await expect(
      service.handleCallbackQuery({
        id: 'callback-type',
        data: 'draft:set-type:income',
        from: { id: 'telegram-user-1' },
        message: {
          message_id: 44,
          chat: { id: 'chat-1' },
        },
      }),
    ).resolves.toEqual({ accepted: true, status: 'pending_review' });

    expect(clearDraftActivePicker).toHaveBeenCalledWith('draft-1', 'chat-1', 44);
    expect(updateDraftField).toHaveBeenCalledWith(
      'draft-1',
      { type: 'income', categoryId: null, categoryName: null },
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
    expect(setActivePickerMessage).not.toHaveBeenCalled();
  });
});

describe('DraftLifecycleService clarification flow', () => {
  const findUniqueOrThrow = jest.fn();
  const pendingCreate = jest.fn();
  const pendingUpdate = jest.fn();
  const sourceMessageUpdate = jest.fn();
  const parseAttemptCreate = jest.fn();
  const parseTransaction = jest.fn();
  const deleteTelegramMessage = jest.fn();
  const clearTelegramInlineKeyboard = jest.fn();
  const sendTelegramMessage = jest.fn();
  const editTelegramMessage = jest.fn();
  const createConfirmedFromDraft = jest.fn();
  const notifyTransactionCreated = jest.fn();

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
      sendTelegramMessage,
      editTelegramMessage,
      deleteTelegramMessage,
      clearTelegramInlineKeyboard,
    } as never,
    draftService,
    {
      createConfirmedFromDraft,
    } as never,
    {
      notifyTransactionCreated,
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'renderDraftCard').mockResolvedValue(undefined);
    deleteTelegramMessage.mockResolvedValue(true);
    clearTelegramInlineKeyboard.mockResolvedValue(true);
  });

  it('fans out notifications after draft confirmation', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      sourceMessageId: 'source-1',
      authorId: 'user-1',
      draft: {
        type: 'expense',
        amount: 25,
        occurredAt: '2026-04-06T00:00:00.000Z',
        categoryId: 'cat-1',
        categoryName: 'Транспорт',
        comment: 'Такси',
        currency: 'EUR',
      },
      sourceMessage: {},
    });
    pendingUpdate.mockResolvedValue({});
    createConfirmedFromDraft.mockResolvedValue({ id: 'tx-1' });
    editTelegramMessage.mockResolvedValue(true);
    notifyTransactionCreated.mockResolvedValue({
      recipients: 2,
      delivered: 2,
      failed: 0,
    });

    await expect(service.confirmDraft('draft-1', 'chat-1', '55')).resolves.toEqual({
      accepted: true,
      status: 'confirmed',
      transactionId: 'tx-1',
    });

    expect(editTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      55,
      expect.stringContaining('Операция сохранена'),
    );
    expect(notifyTransactionCreated).toHaveBeenCalledWith('tx-1');
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

  it('clears the active picker before refreshing the main draft card', async () => {
    jest.restoreAllMocks();
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      draft: {
        type: 'expense',
        amount: 18,
        occurredAt: '2026-04-01T00:00:00.000Z',
        categoryId: 'cat-1',
        categoryName: 'Транспорт',
        comment: 'такси',
        currency: 'EUR',
        confidence: 0.9,
        ambiguities: [],
        followUpQuestion: null,
        sourceText: 'такси',
      },
      lastBotMessageId: '101',
      activePickerMessageId: '202',
    });

    await DraftLifecycleService.prototype.renderDraftCard.call(service, 'draft-1', 'chat-1');

    expect(deleteTelegramMessage).toHaveBeenCalledWith('chat-1', 202);
    expect(editTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      101,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('falls back to clearing inline keyboard when picker deletion fails', async () => {
    jest.restoreAllMocks();
    deleteTelegramMessage.mockResolvedValue(false);
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      draft: {
        type: 'expense',
        amount: 18,
        occurredAt: '2026-04-01T00:00:00.000Z',
        categoryId: 'cat-1',
        categoryName: 'Транспорт',
        comment: 'такси',
        currency: 'EUR',
        confidence: 0.9,
        ambiguities: [],
        followUpQuestion: null,
        sourceText: 'такси',
      },
      lastBotMessageId: '101',
      activePickerMessageId: '202',
    });

    await DraftLifecycleService.prototype.renderDraftCard.call(service, 'draft-1', 'chat-1');

    expect(deleteTelegramMessage).toHaveBeenCalledWith('chat-1', 202);
    expect(clearTelegramInlineKeyboard).toHaveBeenCalledWith('chat-1', 202);
  });

  it('clears the active picker state when a picker selection succeeds', async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      activePickerMessageId: '202',
    });
    pendingUpdate.mockResolvedValue(undefined);

    await service.clearDraftActivePicker('draft-1', 'chat-1', 55);

    expect(pendingUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: { activePickerMessageId: null },
    });
    expect(deleteTelegramMessage).toHaveBeenCalledWith('chat-1', 202);
  });

  it('clears the active picker when cancelling a draft', async () => {
    jest.restoreAllMocks();
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      sourceMessageId: 'source-1',
      activePickerMessageId: '202',
    });

    await service.cancelDraft('draft-1', 'chat-1');

    expect(pendingUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: {
        status: 'CANCELLED',
        activePickerMessageId: null,
        pendingField: null,
      },
    });
    expect(deleteTelegramMessage).toHaveBeenCalledWith('chat-1', 202);
    expect(sourceMessageUpdate).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('clears the active picker when confirming a draft', async () => {
    jest.restoreAllMocks();
    createConfirmedFromDraft.mockResolvedValue({ id: 'transaction-1' });
    editTelegramMessage.mockResolvedValue(true);
    findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      sourceMessageId: 'source-1',
      authorId: 'user-1',
      draft: {
        type: 'expense',
        amount: 18,
        occurredAt: '2026-04-01T00:00:00.000Z',
        categoryId: 'cat-1',
        categoryName: 'Транспорт',
        comment: 'такси',
        currency: 'EUR',
        confidence: 0.9,
        ambiguities: [],
        followUpQuestion: null,
        sourceText: 'такси',
      },
      activePickerMessageId: '202',
      sourceMessage: {},
    });

    await expect(service.confirmDraft('draft-1', 'chat-1', '101')).resolves.toEqual({
      accepted: true,
      status: 'confirmed',
      transactionId: 'transaction-1',
    });

    expect(pendingUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1' },
      data: {
        lastBotMessageId: '101',
        activePickerMessageId: null,
        pendingField: null,
      },
    });
    expect(deleteTelegramMessage).toHaveBeenCalledWith('chat-1', 202);
    expect(editTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      101,
      expect.any(String),
    );
  });
});
