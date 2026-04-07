import { Injectable } from '@nestjs/common';
import { format } from 'date-fns';
import { CategoryType, Prisma } from '@prisma/client';
import { ParsedTransaction } from './services/ai-parsing.service';
import { ActiveCategory, ReviewDraft } from './telegram.types';

@Injectable()
export class TelegramDraftService {
  private resolveCategoryPath(category: ActiveCategory) {
    return category.displayPath ?? category.name;
  }

  createDraftPayload(
    parsed: ParsedTransaction,
    inputText: string,
    defaultCurrency: string,
    categories: ActiveCategory[],
  ): Prisma.InputJsonValue {
    const normalizedCategoryName = this.normalizeCategoryCandidate(parsed.categoryCandidate, categories);
    const category = normalizedCategoryName
      ? categories.find(
          (item) =>
            this.resolveCategoryPath(item).toLowerCase() ===
            normalizedCategoryName.toLowerCase(),
        )
      : null;

    const normalizedDate = this.normalizeDate(parsed.occurredAt);

    const draft: ReviewDraft = {
      type: parsed.type,
      amount: parsed.amount,
      occurredAt: normalizedDate ?? new Date().toISOString(),
      categoryId: category?.id ?? null,
      categoryName: category ? this.resolveCategoryPath(category) : null,
      comment: parsed.comment ?? inputText ?? null,
      currency: parsed.resolvedCurrency ?? defaultCurrency,
      confidence: parsed.confidence,
      ambiguities: parsed.ambiguities,
      followUpQuestion: parsed.followUpQuestion ?? null,
      sourceText: inputText,
    };

    return draft as unknown as Prisma.InputJsonValue;
  }

  mergeDraftWithParsed(
    currentDraft: ReviewDraft,
    parsed: ParsedTransaction,
    inputText: string,
    defaultCurrency: string,
    categories: ActiveCategory[],
  ): ReviewDraft {
    const nextDraft = this.createDraftPayload(
      parsed,
      inputText,
      defaultCurrency,
      categories,
    ) as unknown as ReviewDraft;

    return {
      ...currentDraft,
      ...nextDraft,
      type: nextDraft.type ?? currentDraft.type,
      amount: nextDraft.amount ?? currentDraft.amount,
      occurredAt: nextDraft.occurredAt ?? currentDraft.occurredAt,
      categoryId: nextDraft.categoryId ?? currentDraft.categoryId,
      categoryName: nextDraft.categoryName ?? currentDraft.categoryName,
      comment: nextDraft.comment ?? currentDraft.comment,
      currency: nextDraft.currency ?? currentDraft.currency ?? defaultCurrency,
      confidence: Math.max(currentDraft.confidence ?? 0, nextDraft.confidence ?? 0),
      ambiguities: nextDraft.ambiguities,
      followUpQuestion: nextDraft.followUpQuestion ?? currentDraft.followUpQuestion,
      sourceText: [currentDraft.sourceText, inputText].filter(Boolean).join('\n'),
    };
  }

  normalizeDate(value: string | null) {
    if (!value) return null;
    const lower = value.toLowerCase();
    if (/(yesterday|вчера)/.test(lower)) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString();
    }
    if (/(tomorrow|завтра)/.test(lower)) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString();
    }
    if (/(today|current|текущ|сегодня)/.test(lower)) {
      return new Date().toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `${value}T00:00:00.000Z`;
    }
    if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(value) && !value.endsWith('Z')) {
      return `${value}Z`;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  applyHeuristics(
    parsed: ParsedTransaction,
    text: string,
    categories: ActiveCategory[],
    defaultCurrency: string,
  ): ParsedTransaction {
    const normalized = text.toLowerCase();
    const next: ParsedTransaction = {
      ...parsed,
      ambiguities: [...parsed.ambiguities],
      resolvedCurrency: parsed.resolvedCurrency ?? defaultCurrency,
    };

    if (!next.amount) {
      const amountMatch = normalized.match(/(\d+(?:[.,]\d+)?)/);
      if (amountMatch) {
        next.amount = Number(amountMatch[1].replace(',', '.'));
      }
    }

    if (!next.type) {
      if (/(зарплат|доход|получил|получила|пришло|преми)/.test(normalized)) {
        next.type = 'income';
      } else if (/(добавь|купил|купила|за |такси|еда|продукт|заплат|расход)/.test(normalized)) {
        next.type = 'expense';
      }
    }

    const normalizedDate = this.normalizeDate(next.occurredAt);
    next.occurredAt = normalizedDate ?? new Date().toISOString();

    if (!next.categoryCandidate) {
      const hints: Array<[RegExp, string]> = [
        [/(такси|метро|автобус|транспорт|uber|яндекс go)/, 'транспорт'],
        [/(lidl|aldi|kaufland|spar|tesco|ашан|пятерочк|перекрест|магнит|дикси|продукт|еда|магазин|кофе|ресторан)/, 'продукт'],
        [/(дом|квартир|аренд|жкх)/, 'дом'],
        [/(врач|аптек|лекарств|здоров)/, 'здоров'],
        [/(зарплат|доход|преми|гонорар)/, 'доход'],
      ];
      for (const [pattern, token] of hints) {
        const candidate = categories.find(
          (item) =>
            pattern.test(normalized) &&
            this.resolveCategoryPath(item).toLowerCase().includes(token) &&
            (!next.type ||
              item.type ===
                (next.type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE)),
        );

        if (candidate) {
          next.categoryCandidate = this.resolveCategoryPath(candidate);
          break;
        }
      }
    }

    next.ambiguities = next.ambiguities.filter((item) => {
      const lowered = item.toLowerCase();
      if (next.type && lowered.includes('type')) return false;
      if (next.amount && lowered.includes('amount')) return false;
      if (next.occurredAt && lowered.includes('date')) return false;
      if (next.categoryCandidate && lowered.includes('categor')) return false;
      return true;
    });

    return next;
  }

  normalizeCategoryCandidate(categoryCandidate: string | null, categories: ActiveCategory[]) {
    if (!categoryCandidate) {
      return null;
    }

    const normalizedCandidate = categoryCandidate.trim().toLowerCase();
    const match = categories.find(
      (item) => this.resolveCategoryPath(item).trim().toLowerCase() === normalizedCandidate,
    );
    return match ? this.resolveCategoryPath(match) : null;
  }

  renderDraftText(draft: ReviewDraft, confirmed: boolean) {
    const missing = this.getMissingDraftFields(draft);
    const lines = [
      confirmed
        ? 'Операция сохранена'
        : missing.length > 0
          ? 'Нужно уточнить операцию'
          : 'Проверьте операцию перед сохранением',
      '',
      `Тип: ${draft.type === 'income' ? 'Доход' : draft.type === 'expense' ? 'Расход' : 'Не определено'}`,
      `Сумма: ${draft.amount ?? 'Не определено'} ${draft.currency ?? ''}`.trim(),
      `Дата: ${draft.occurredAt ? format(new Date(draft.occurredAt), 'dd.MM.yyyy') : 'Не определено'}`,
      `Категория: ${draft.categoryName ?? 'Не определено'}`,
      `Комментарий: ${draft.comment ?? 'Не определено'}`,
    ];
    if (!confirmed && missing.length > 0) {
      lines.push('', `Не хватает: ${missing.join(', ')}.`);
      lines.push(
        draft.followUpQuestion
          ? `Уточнение: ${draft.followUpQuestion}`
          : 'Можно ответить сообщением в чат или исправить поля кнопками ниже.',
      );
    }
    return lines.join('\n');
  }

  renderDraftSummary(draft: ReviewDraft) {
    return [
      `тип ${draft.type ?? 'не определен'}`,
      `сумма ${draft.amount ?? 'не определена'} ${draft.currency ?? ''}`.trim(),
      `дата ${draft.occurredAt ? format(new Date(draft.occurredAt), 'dd.MM.yyyy') : 'не определена'}`,
      `категория ${draft.categoryName ?? 'не определена'}`,
      `комментарий ${draft.comment ?? 'не определен'}`,
    ].join(', ');
  }

  getMissingDraftFields(draft: ReviewDraft) {
    return [
      !draft.type ? 'тип' : null,
      !draft.amount ? 'сумма' : null,
      !draft.occurredAt ? 'дата' : null,
      !draft.categoryId ? 'категория' : null,
    ].filter((value): value is string => Boolean(value));
  }

  isCancelCommand(text: string) {
    return ['отмена', 'стоп', 'cancel', '/cancel'].includes(text.trim().toLowerCase());
  }
}
