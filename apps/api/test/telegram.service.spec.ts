import { CategoryType } from '@prisma/client';
import { TelegramService } from '../src/modules/telegram/telegram.service';

describe('TelegramService heuristics', () => {
  const service = new TelegramService(
    {} as never,
    {} as never,
    {} as never,
    {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as never,
  );

  it('fills sensible defaults for taxi expense', () => {
    const parsed = (service as any).applyHeuristics(
      {
        type: null,
        amount: null,
        occurredAt: null,
        categoryCandidate: null,
        comment: null,
        confidence: 0.4,
        ambiguities: ['transaction type', 'amount', 'date', 'category'],
        followUpQuestion: null,
        resolvedCurrency: null,
      },
      'Добавь 10 евро за такси',
      [
        { id: '1', name: 'Продукты', type: CategoryType.EXPENSE },
        { id: '2', name: 'Транспорт', type: CategoryType.EXPENSE },
        { id: '3', name: 'Дом', type: CategoryType.EXPENSE },
      ],
      'RUB',
    );

    expect(parsed.type).toBe('expense');
    expect(parsed.amount).toBe(10);
    expect(parsed.categoryCandidate).toBe('Транспорт');
    expect(parsed.resolvedCurrency).toBe('RUB');
  });

  it('maps Lidl to groceries category', () => {
    const parsed = (service as any).applyHeuristics(
      {
        type: null,
        amount: null,
        occurredAt: null,
        categoryCandidate: null,
        comment: null,
        confidence: 0.4,
        ambiguities: ['transaction type', 'amount', 'date', 'category'],
        followUpQuestion: null,
        resolvedCurrency: null,
      },
      'Lidl 23.40',
      [
        { id: '1', name: 'Продукты', type: CategoryType.EXPENSE },
        { id: '2', name: 'Транспорт', type: CategoryType.EXPENSE },
      ],
      'EUR',
    );

    expect(parsed.categoryCandidate).toBe('Продукты');
    expect(parsed.occurredAt).not.toBeNull();
  });

  it('resolves current date words to today', () => {
    const parsed = (service as any).applyHeuristics(
      {
        type: 'expense',
        amount: 10,
        occurredAt: null,
        categoryCandidate: 'Транспорт',
        comment: null,
        confidence: 0.7,
        ambiguities: ['date'],
        followUpQuestion: null,
        resolvedCurrency: null,
      },
      'Текущая',
      [{ id: '2', name: 'Транспорт', type: CategoryType.EXPENSE }],
      'RUB',
    );

    expect(parsed.occurredAt).not.toBeNull();
  });

  it('defaults missing date to current date', () => {
    const parsed = (service as any).applyHeuristics(
      {
        type: 'expense',
        amount: 23.4,
        occurredAt: null,
        categoryCandidate: 'Продукты',
        comment: null,
        confidence: 0.7,
        ambiguities: ['date'],
        followUpQuestion: null,
        resolvedCurrency: null,
      },
      'Lidl 23.40',
      [{ id: '1', name: 'Продукты', type: CategoryType.EXPENSE }],
      'EUR',
    );

    expect(parsed.occurredAt).not.toBeNull();
  });
});
