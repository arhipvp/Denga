import axios from 'axios';
import { MessageIngestionService } from '../src/modules/telegram/message-ingestion.service';
import { TelegramDeliveryService } from '../src/modules/telegram/telegram-delivery.service';
import {
  TELEGRAM_ADD_OPERATION_MENU_LABEL,
  TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK,
  TELEGRAM_EXPENSE_CURRENT_MONTH_LABEL,
  TELEGRAM_STATS_MENU_LABEL,
} from '../src/modules/telegram/telegram-menu';

jest.mock('../src/modules/common/runtime-config', () => ({
  getApiRuntimeConfig: jest.fn(() => ({
    telegramBotToken: 'test-token',
    telegramMode: 'polling',
    telegramWebhookUrl: '',
  })),
}));

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    request: jest.fn(),
    isAxiosError: jest.fn(() => false),
  },
}));

describe('Telegram menu delivery', () => {
  const loggingService = {
    warn: jest.fn(),
  };
  const service = new TelegramDeliveryService(loggingService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.request as jest.Mock).mockResolvedValue({
      data: {
        result: {
          message_id: 99,
        },
      },
    });
  });

  it('adds the persistent reply keyboard when no custom reply markup is provided', async () => {
    await service.sendTelegramMessage('chat-1', 'Привет');

    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chat_id: 'chat-1',
          text: 'Привет',
          reply_markup: {
            keyboard: [[
              { text: TELEGRAM_ADD_OPERATION_MENU_LABEL },
              { text: TELEGRAM_STATS_MENU_LABEL },
            ]],
            resize_keyboard: true,
            is_persistent: true,
          },
        }),
      }),
    );
  });

  it('keeps explicit reply markup untouched', async () => {
    const customReplyMarkup = {
      inline_keyboard: [[{ text: 'Подтвердить', callback_data: 'draft:confirm' }]],
    };

    await service.sendTelegramMessage('chat-1', 'Черновик', customReplyMarkup);

    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reply_markup: customReplyMarkup,
        }),
      }),
    );
  });

  it('sends photo payloads without affecting text menu behavior', async () => {
    await service.sendTelegramPhoto({
      chatId: 'chat-1',
      fileName: 'chart.png',
      photo: Buffer.from('png-data'),
      caption: 'Отчет',
    });

    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/sendPhoto'),
        data: expect.any(FormData),
      }),
    );
  });
});

describe('MessageIngestionService menu actions', () => {
  const telegramAccountFindUnique = jest.fn();
  const userCreate = jest.fn();
  const pendingOperationReviewFindFirst = jest.fn();
  const sourceMessageUpsert = jest.fn();
  const persistAttachments = jest.fn();
  const createDraftFromMessage = jest.fn();
  const sendTelegramMessage = jest.fn();

  const service = new MessageIngestionService(
    {
      telegramAccount: {
        findUnique: telegramAccountFindUnique,
      },
      user: {
        create: userCreate,
      },
      pendingOperationReview: {
        findFirst: pendingOperationReviewFindFirst,
      },
      sourceMessage: {
        upsert: sourceMessageUpsert,
      },
    } as never,
    {
      getHouseholdId: jest.fn().mockReturnValue('household-1'),
    } as never,
    {
      info: jest.fn(),
    } as never,
    {
      persistAttachments,
    } as never,
    {
      createDraftFromMessage,
      cancelDraft: jest.fn(),
      reparseDraftWithClarification: jest.fn(),
    } as never,
    {
      applyManualEdit: jest.fn(),
    } as never,
    {
      sendTelegramMessage,
    } as never,
    {
      isCancelCommand: jest.fn().mockReturnValue(false),
    } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    telegramAccountFindUnique.mockResolvedValue({
      user: { id: 'user-1' },
    });
    pendingOperationReviewFindFirst.mockResolvedValue(null);
    sourceMessageUpsert.mockResolvedValue({
      id: 'source-1',
      telegramMessageId: '1',
    });
    persistAttachments.mockResolvedValue([]);
    createDraftFromMessage.mockResolvedValue({ accepted: true, status: 'draft_created' });
    sendTelegramMessage.mockResolvedValue({ message_id: 10 });
  });

  it('shows the menu on /start without creating a source message', async () => {
    await expect(
      service.handleMessage(
        {
          message_id: 1,
          chat: { id: 'chat-1' },
          text: '/start',
          from: { id: 'telegram-user-1' },
        },
        {},
      ),
    ).resolves.toEqual({
      accepted: true,
      status: 'menu_shown',
      authorId: 'user-1',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'Привет! Отправьте сообщение с операцией или фото чека.',
    );
    expect(sourceMessageUpsert).not.toHaveBeenCalled();
    expect(createDraftFromMessage).not.toHaveBeenCalled();
  });

  it('shows add operation prompt without creating a source message', async () => {
    await expect(
      service.handleMessage(
        {
          message_id: 1,
          chat: { id: 'chat-1' },
          text: TELEGRAM_ADD_OPERATION_MENU_LABEL,
          from: { id: 'telegram-user-1' },
        },
        {},
      ),
    ).resolves.toEqual({
      accepted: true,
      status: 'add_operation_prompt_shown',
      authorId: 'user-1',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'Отправьте сообщение с операцией или фото чека. Например: <b>Такси 12 EUR</b>.',
    );
    expect(sourceMessageUpsert).not.toHaveBeenCalled();
    expect(createDraftFromMessage).not.toHaveBeenCalled();
  });

  it('ignores the statistics menu action without creating a source message', async () => {
    sendTelegramMessage.mockResolvedValue({ message_id: 11 });

    await expect(
      service.handleMessage(
        {
          message_id: 1,
          chat: { id: 'chat-1' },
          text: TELEGRAM_STATS_MENU_LABEL,
          from: { id: 'telegram-user-1' },
        },
        {},
      ),
    ).resolves.toEqual({
      accepted: true,
      status: 'stats_menu_shown',
      authorId: 'user-1',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'Выберите отчет:',
      {
        inline_keyboard: [[{
          text: TELEGRAM_EXPENSE_CURRENT_MONTH_LABEL,
          callback_data: TELEGRAM_EXPENSE_CURRENT_MONTH_CALLBACK,
        }]],
      },
    );
    expect(sourceMessageUpsert).not.toHaveBeenCalled();
    expect(createDraftFromMessage).not.toHaveBeenCalled();
  });

  it('keeps normal text messages on the regular operation ingestion path', async () => {
    await expect(
      service.handleMessage(
        {
          message_id: 1,
          chat: { id: 'chat-1' },
          text: 'Такси 12 евро',
          from: { id: 'telegram-user-1' },
        },
        { update_id: 1 },
      ),
    ).resolves.toEqual({ accepted: true, status: 'draft_created' });

    expect(sourceMessageUpsert).toHaveBeenCalled();
    expect(persistAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Такси 12 евро' }),
      'source-1',
    );
    expect(createDraftFromMessage).toHaveBeenCalledWith(
      'source-1',
      'user-1',
      'chat-1',
      'Такси 12 евро',
      [],
    );
  });
});
