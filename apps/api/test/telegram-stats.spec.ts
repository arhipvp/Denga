import { TelegramStatsChartRenderer } from '../src/modules/telegram/telegram-stats-chart.renderer';
import { TelegramStatsService } from '../src/modules/telegram/telegram-stats.service';

describe('TelegramStatsService', () => {
  const getCurrentMonthExpenseBreakdown = jest.fn();
  const getCurrentMonthIncomeBreakdown = jest.fn();
  const sendTelegramMessage = jest.fn();
  const sendTelegramPhoto = jest.fn();
  const renderer = new TelegramStatsChartRenderer();
  const renderCategoryBreakdown = jest.spyOn(renderer, 'renderCategoryBreakdown');

  const service = new TelegramStatsService(
    {
      getCurrentMonthExpenseBreakdown,
      getCurrentMonthIncomeBreakdown,
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
      totalAmount: 0,
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
      totalAmount: 200,
      items: [
        { categoryId: 'food', categoryName: 'Еда', amount: 120, share: 0.6 },
        { categoryId: 'taxi', categoryName: 'Такси', amount: 80, share: 0.4 },
      ],
    });

    await expect(service.sendCurrentMonthExpenseReport('chat-1')).resolves.toEqual({
      accepted: true,
      status: 'stats_sent',
    });

    expect(renderCategoryBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 200 }),
      'Расходы',
    );
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
      totalAmount: 1500,
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

  it('sends an empty-state text when there are no confirmed incomes', async () => {
    getCurrentMonthIncomeBreakdown.mockResolvedValue({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 0,
      items: [],
    });

    await expect(service.sendCurrentMonthIncomeReport('chat-1')).resolves.toEqual({
      accepted: true,
      status: 'stats_empty',
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith(
      'chat-1',
      'В этом месяце подтвержденных доходов пока нет.',
    );
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
  });

  it('sends a chart and caption for the current month income report', async () => {
    getCurrentMonthIncomeBreakdown.mockResolvedValue({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 1800,
      items: [
        { categoryId: 'salary', categoryName: 'Зарплата', amount: 1500, share: 1500 / 1800 },
        { categoryId: 'bonus', categoryName: 'Бонус', amount: 300, share: 300 / 1800 },
      ],
    });

    await expect(service.sendCurrentMonthIncomeReport('chat-1')).resolves.toEqual({
      accepted: true,
      status: 'stats_sent',
    });

    expect(renderCategoryBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 1800 }),
      'Доходы',
    );
    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'income-current-month.png',
        caption: expect.stringContaining('<b>Отчет по доходам</b>'),
      }),
    );
    expect(sendTelegramPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: expect.stringContaining('• Зарплата — <b>1 500,00 EUR</b> (83.3%)'),
      }),
    );
  });
});

describe('TelegramStatsChartRenderer', () => {
  it('renders a PNG buffer for the expense report chart', () => {
    const renderer = new TelegramStatsChartRenderer();

    const buffer = renderer.renderExpenseBreakdown({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 200,
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

  it('renders visible text in the title area', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderExpenseBreakdownCanvas({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 200,
      items: [
        { categoryId: 'food', categoryName: 'Еда', amount: 120, share: 0.6 },
        { categoryId: 'taxi', categoryName: 'Такси', amount: 80, share: 0.4 },
      ],
    });

    const ctx = canvas.getContext('2d');
    const titlePixels = countNonBackgroundPixels(ctx, 40, 20, 520, 110);

    expect(titlePixels).toBeGreaterThan(1200);
  });

  it('renders visible text in the legend area, not only color markers', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderExpenseBreakdownCanvas({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 200,
      items: [
        { categoryId: 'food', categoryName: 'Продукты', amount: 120, share: 0.6 },
        { categoryId: 'taxi', categoryName: 'Такси', amount: 80, share: 0.4 },
      ],
    });

    const ctx = canvas.getContext('2d');
    const markerPixels = countNonBackgroundPixels(ctx, 555, 185, 40, 120);
    const legendTextPixels = countNonBackgroundPixels(ctx, 600, 185, 500, 120);

    expect(markerPixels).toBeGreaterThan(300);
    expect(legendTextPixels).toBeGreaterThan(1500);
  });

  it('renders percent labels on large donut segments', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderExpenseBreakdownCanvas({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 346.2,
      items: [
        { categoryId: 'food', categoryName: 'Продукты', amount: 108, share: 0.312 },
        { categoryId: 'beauty', categoryName: 'Красота', amount: 60, share: 0.173 },
        { categoryId: 'gifts', categoryName: 'Подарки', amount: 55, share: 0.159 },
        { categoryId: 'cafe', categoryName: 'Кафе и рестораны', amount: 49, share: 0.142 },
        { categoryId: 'home', categoryName: 'Дом', amount: 39, share: 0.113 },
        { categoryId: 'other', categoryName: 'Прочие категории', amount: 35.2, share: 0.102 },
      ],
    });

    const ctx = canvas.getContext('2d');
    const percentPixels = countNonMatchingPixels(ctx, 320, 240, 120, 120, [37, 99, 235, 255]);

    expect(percentPixels).toBeGreaterThan(180);
  });

  it('does not force percent labels onto narrow segments', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderExpenseBreakdownCanvas({
      periodLabel: 'Апрель 2026',
      currency: 'EUR',
      totalAmount: 1000,
      items: [{ categoryId: 'major', categoryName: 'Крупная категория', amount: 1000, share: 1 }],
    });

    const ctx = canvas.getContext('2d');
    const canRender = (renderer as any).canRenderSegmentLabel(
      ctx,
      '6.0%',
      { share: 0.06, sweep: Math.PI * 2 * 0.06 },
      146.3,
    );

    expect(canRender).toBe(false);
  });

  it('renders a visible full-circle donut for a single income category', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderCategoryBreakdownCanvas(
      {
        periodLabel: 'Апрель 2026',
        currency: 'EUR',
        totalAmount: 700,
        items: [
          {
            categoryId: 'salary',
            categoryName: 'Вова заработал',
            amount: 700,
            share: 1,
          },
        ],
      },
      'Доходы',
    );

    const ctx = canvas.getContext('2d');
    const donutPixels = countNonBackgroundPixels(ctx, 120, 210, 340, 340);

    expect(donutPixels).toBeGreaterThan(20000);
  });

  it('renders a visible full-circle donut for a single expense category', () => {
    const renderer = new TelegramStatsChartRenderer();
    const canvas = renderer.renderCategoryBreakdownCanvas(
      {
        periodLabel: 'Апрель 2026',
        currency: 'EUR',
        totalAmount: 700,
        items: [
          {
            categoryId: 'food',
            categoryName: 'Продукты',
            amount: 700,
            share: 1,
          },
        ],
      },
      'Расходы',
    );

    const ctx = canvas.getContext('2d');
    const donutPixels = countNonBackgroundPixels(ctx, 120, 210, 340, 340);

    expect(donutPixels).toBeGreaterThan(20000);
  });
});

function countNonBackgroundPixels(
  context: ReturnType<ReturnType<TelegramStatsChartRenderer['renderExpenseBreakdownCanvas']>['getContext']>,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageData = context.getImageData(x, y, width, height).data;
  let count = 0;

  for (let index = 0; index < imageData.length; index += 4) {
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];

    if (!(r === 248 && g === 250 && b === 252 && a === 255)) {
      count += 1;
    }
  }

  return count;
}

function countNonMatchingPixels(
  context: ReturnType<ReturnType<TelegramStatsChartRenderer['renderExpenseBreakdownCanvas']>['getContext']>,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: [number, number, number, number],
) {
  const imageData = context.getImageData(x, y, width, height).data;
  let count = 0;

  for (let index = 0; index < imageData.length; index += 4) {
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];

    if (!(r === rgba[0] && g === rgba[1] && b === rgba[2] && a === rgba[3])) {
      count += 1;
    }
  }

  return count;
}
