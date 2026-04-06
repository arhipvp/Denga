import { TelegramStatsChartRenderer } from '../src/modules/telegram/telegram-stats-chart.renderer';
import { TelegramStatsService } from '../src/modules/telegram/telegram-stats.service';

describe('TelegramStatsService', () => {
  const getCurrentMonthExpenseBreakdown = jest.fn();
  const sendTelegramMessage = jest.fn();
  const sendTelegramPhoto = jest.fn();
  const renderer = new TelegramStatsChartRenderer();
  const renderExpenseBreakdown = jest.spyOn(renderer, 'renderExpenseBreakdown');

  const service = new TelegramStatsService(
    {
      getCurrentMonthExpenseBreakdown,
    } as never,
    {
      sendTelegramMessage,
      sendTelegramPhoto,
    } as never,
    renderer,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sendTelegramMessage.mockResolvedValue({ message_id: 1 });
    sendTelegramPhoto.mockResolvedValue({ message_id: 2 });
  });

  it('sends an empty-state text when there are no confirmed expenses', async () => {
    getCurrentMonthExpenseBreakdown.mockResolvedValue({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 0,
      items: [],
    });

    await expect(service.sendCurrentMonthExpenseReport('chat-1')).resolves.toEqual({
      accepted: true,
      status: 'stats_empty',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'В этом месяце подтвержденных расходов пока нет.',
    );
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
  });

  it('sends a chart and caption for the current month expense report', async () => {
    getCurrentMonthExpenseBreakdown.mockResolvedValue({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 200,
      items: [
        { categoryId: 'food', categoryName: 'Еда', amount: 120, share: 0.6 },
        { categoryId: 'taxi', categoryName: 'Такси', amount: 80, share: 0.4 },
      ],
    });

    await expect(service.sendCurrentMonthExpenseReport('chat-1')).resolves.toEqual({
      accepted: true,
      status: 'stats_sent',
    });

    expect(renderExpenseBreakdown).toHaveBeenCalled();
    expect(sendTelegramPhoto).toHaveBeenCalledWith({
      chatId: 'chat-1',
      fileName: 'expense-current-month.png',
      photo: expect.any(Buffer),
      caption: expect.stringContaining('Итого: <b>200,00 EUR</b>'),
    });
    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: expect.stringContaining('<b>Категории</b>'),
      }),
    );
    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: expect.stringContaining('• Еда — <b>120,00 EUR</b> (60.0%)'),
      }),
    );
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('falls back to a follow-up text when the caption becomes too long', async () => {
    getCurrentMonthExpenseBreakdown.mockResolvedValue({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 1500,
      items: Array.from({ length: 18 }, (_, index) => ({
        categoryId: `cat-${index + 1}`,
        categoryName: `Очень длинная категория ${index + 1} с подробным названием`,
        amount: 80 + index,
        share: 1 / 18,
      })),
    });

    await service.sendCurrentMonthExpenseReport('chat-1');

    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: expect.stringContaining('Итого: <b>1 500,00 EUR</b>'),
      }),
    );
    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: expect.stringContaining('Полный список категорий отправлен следующим сообщением.'),
      }),
    );
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      expect.stringContaining('Очень длинная категория 18'),
    );
  });
});

describe('TelegramStatsChartRenderer', () => {
  it('renders a PNG buffer for the expense report chart', () => {
    const renderer = new TelegramStatsChartRenderer();

    const buffer = renderer.renderExpenseBreakdown({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalExpense: 200,
      items: [
        { categoryId: 'food', categoryName: 'Еда', amount: 120, share: 0.6 },
        { categoryId: 'taxi', categoryName: 'Такси', amount: 80, share: 0.4 },
      ],
    });

    expect(buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
