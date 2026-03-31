import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AiParseAttemptType,
  CategoryType,
  Prisma,
  SourceMessageStatus,
  SourceMessageType,
  TransactionStatus,
  TransactionType,
  UserRole,
} from '@prisma/client';
import axios, { AxiosRequestConfig } from 'axios';
import { format } from 'date-fns';
import { Decimal } from '@prisma/client/runtime/library';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  AiParsingService,
  ParsedTransaction,
} from './services/ai-parsing.service';

type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
  from?: {
    id: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  photo?: Array<{ file_id: string }>;
  document?: {
    file_id: string;
    mime_type?: string;
    file_name?: string;
  };
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from: {
    id: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  message?: {
    message_id: number;
    chat: { id: number | string };
  };
};

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type ReviewDraft = {
  type: 'income' | 'expense' | null;
  amount: number | null;
  occurredAt: string | null;
  categoryId: string | null;
  categoryName: string | null;
  comment: string | null;
  currency: string | null;
  confidence: number;
  ambiguities: string[];
  followUpQuestion: string | null;
  sourceText: string | null;
};

type ConversationEntry = {
  role: 'assistant' | 'user';
  text: string;
  at: string;
};

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly telegramRequestRetries = 3;
  private readonly telegramRequestBaseDelayMs = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly aiParsingService: AiParsingService,
    private readonly loggingService: LoggingService,
  ) {}

  async getStatus() {
    return {
      mode: process.env.TELEGRAM_MODE ?? 'polling',
      botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || null,
    };
  }

  async handleUpdate(update: Record<string, unknown>) {
    const payload = update as TelegramUpdate;

    try {
      if (payload.callback_query) {
        return await this.handleCallbackQuery(payload.callback_query);
      }

      if (!payload.message) {
        return { accepted: true, ignored: true };
      }

      return await this.handleMessage(payload.message, update);
    } catch (error) {
      this.logger.error('telegram_update_failed', error);
      this.loggingService.error('telegram', 'update_failed', 'Telegram update processing failed', {
        exception: error,
      });
      return { accepted: true, error: true };
    }
  }

  private async handleMessage(message: TelegramMessage, rawUpdate: Record<string, unknown>) {
    const author = await this.upsertTelegramUser(message);
    const chatId = String(message.chat.id);
    const text = (message.text ?? message.caption ?? '').trim();
    const hasAttachment = Boolean(message.photo?.length || message.document);

    const existingDraft = await this.prisma.pendingOperationReview.findFirst({
      where: {
        authorId: author.id,
        status: SourceMessageStatus.PENDING_REVIEW,
      },
      include: {
        sourceMessage: {
          include: { attachments: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existingDraft) {
      if (hasAttachment && !existingDraft.pendingField) {
        await this.cancelDraft(existingDraft.id);
        await this.sendTelegramMessage(
          chatId,
          'Предыдущий черновик закрыт. Обрабатываю новый чек как отдельную операцию.',
        );
      } else {
      if (this.isCancelCommand(text)) {
        await this.cancelDraft(existingDraft.id);
        await this.sendTelegramMessage(chatId, 'Черновик отменен. Можете отправить новую операцию.');
        return { accepted: true, status: 'cancelled' };
      }

      if (existingDraft.pendingField) {
        return this.applyManualEdit(existingDraft.id, existingDraft.pendingField, text, chatId);
      }

      return this.reparseExistingDraft(existingDraft.id, text, chatId);
      }
    }

    const sourceMessage = await this.prisma.sourceMessage.upsert({
      where: {
        telegramMessageId: String(message.message_id),
      },
      update: {
        rawPayload: rawUpdate as Prisma.InputJsonValue,
      },
      create: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        authorId: author.id,
        telegramMessageId: String(message.message_id),
        telegramChatId: chatId,
        type: message.photo || message.document
          ? SourceMessageType.TELEGRAM_RECEIPT
          : SourceMessageType.TELEGRAM_TEXT,
        status: SourceMessageStatus.RECEIVED,
        text: text || null,
        rawPayload: rawUpdate as Prisma.InputJsonValue,
      },
    });

    const attachments = await this.persistAttachments(message, sourceMessage.id);
    this.loggingService.info('telegram', 'message_received', 'Telegram message received', {
      sourceMessageId: sourceMessage.id,
      telegramMessageId: sourceMessage.telegramMessageId,
      authorId: author.id,
      hasAttachment,
    });
    return this.createDraftFromMessage(sourceMessage.id, author.id, chatId, text, attachments);
  }

  private async handleCallbackQuery(callback: TelegramCallbackQuery) {
    const data = callback.data ?? '';
    const chatId = String(callback.message?.chat.id ?? callback.from.id);
    const messageId = String(callback.message?.message_id ?? '');
    const authorId = String(callback.from.id);
    const author = await this.prisma.telegramAccount.findUnique({
      where: { telegramId: authorId },
      include: { user: true },
    });

    if (!author?.user) {
      await this.answerCallbackQuery(callback.id, 'Пользователь не найден');
      return { accepted: true, ignored: true };
    }

    const draft = await this.prisma.pendingOperationReview.findFirst({
      where: {
        authorId: author.user.id,
        status: SourceMessageStatus.PENDING_REVIEW,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!draft) {
      await this.answerCallbackQuery(callback.id, 'Активный черновик не найден');
      return { accepted: true, ignored: true };
    }

    if (data === 'draft:confirm') {
      await this.answerCallbackQuery(callback.id);
      return this.confirmDraft(draft.id, chatId, messageId);
    }

    if (data === 'draft:cancel') {
      await this.answerCallbackQuery(callback.id);
      await this.cancelDraft(draft.id);
      await this.editTelegramMessage(chatId, Number(messageId), 'Операция отменена.');
      return { accepted: true, status: 'cancelled' };
    }

    if (data.startsWith('draft:edit:')) {
      const field = data.replace('draft:edit:', '');
      await this.answerCallbackQuery(callback.id);
      return this.beginFieldEdit(draft.id, field, chatId);
    }

    if (data.startsWith('draft:set-type:')) {
      const value = data.replace('draft:set-type:', '') as 'income' | 'expense';
      await this.answerCallbackQuery(callback.id);
      return this.updateDraftField(draft.id, { type: value, categoryId: null, categoryName: null }, chatId);
    }

    if (data.startsWith('draft:set-category:')) {
      const categoryId = data.replace('draft:set-category:', '');
      const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) {
        await this.answerCallbackQuery(callback.id, 'Категория не найдена');
        return { accepted: true, ignored: true };
      }
      await this.answerCallbackQuery(callback.id);
      return this.updateDraftField(
        draft.id,
        { categoryId: category.id, categoryName: category.name },
        chatId,
      );
    }

    await this.answerCallbackQuery(callback.id, 'Неизвестное действие');
    return { accepted: true, ignored: true };
  }

  private async createDraftFromMessage(
    sourceMessageId: string,
    authorId: string,
    chatId: string,
    inputText: string,
    attachments: Array<{
      telegramFileId?: string | null;
      telegramFilePath?: string | null;
      mimeType?: string | null;
    }>,
  ) {
    const settings = await this.settingsService.getSettings();
    const parsed = await this.safeParse({
      sourceMessageId,
      attemptType: AiParseAttemptType.INITIAL_PARSE,
      inputText,
      imageDataUrl: attachments[0]
        ? await this.buildAttachmentDataUrl(
            attachments[0].telegramFileId ?? null,
            attachments[0].telegramFilePath ?? null,
            attachments[0].mimeType,
          )
        : undefined,
      conversationContext: [],
      model: settings.aiModel,
      parsingPrompt: settings.parsingPrompt,
      clarificationPrompt: settings.clarificationPrompt,
      defaultCurrency: settings.defaultCurrency,
    });

    const categories = await this.loadActiveCategories(parsed.type);
    const draft = await this.prisma.pendingOperationReview.create({
      data: {
        sourceMessageId,
        authorId,
        status: SourceMessageStatus.PENDING_REVIEW,
        draft: this.createDraftPayload(parsed, inputText, settings.defaultCurrency, categories),
      },
    });

    await this.prisma.sourceMessage.update({
      where: { id: sourceMessageId },
      data: { status: SourceMessageStatus.PENDING_REVIEW },
    });

    this.logger.log(`draft_created source=${sourceMessageId}`);
    await this.renderDraftCard(draft.id, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  private async reparseExistingDraft(draftId: string, userText: string, chatId: string) {
    const draftRecord = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
      include: {
        sourceMessage: {
          include: { attachments: true, parseAttempts: true },
        },
      },
    });
    const settings = await this.settingsService.getSettings();
    const currentDraft = draftRecord.draft as unknown as ReviewDraft;
    const previousConversation: ConversationEntry[] = [];
    const parsed = await this.safeParse({
      sourceMessageId: draftRecord.sourceMessageId,
      attemptType: AiParseAttemptType.CLARIFICATION_REPARSE,
      inputText: userText,
      imageDataUrl: draftRecord.sourceMessage.attachments[0]
        ? await this.buildAttachmentDataUrl(
            draftRecord.sourceMessage.attachments[0].telegramFileId,
            draftRecord.sourceMessage.attachments[0].telegramFilePath,
            draftRecord.sourceMessage.attachments[0].mimeType,
          )
        : undefined,
      conversationContext: [
        ...previousConversation.map((item) => ({ role: item.role, text: item.text })),
        {
          role: 'assistant' as const,
          text:
            currentDraft.followUpQuestion ??
            `Текущий черновик: ${this.renderDraftSummary(currentDraft)}.`,
        },
        { role: 'user' as const, text: userText },
      ],
      model: settings.aiModel,
      parsingPrompt: settings.parsingPrompt,
      clarificationPrompt: settings.clarificationPrompt,
      defaultCurrency: settings.defaultCurrency,
    });

    const categories = await this.loadActiveCategories(parsed.type);
    const nextDraft = this.mergeDraftWithParsed(
      currentDraft,
      parsed,
      userText,
      settings.defaultCurrency,
      categories,
    );
    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        draft: nextDraft as unknown as Prisma.InputJsonValue,
        pendingField: null,
      },
    });

    this.logger.log(`draft_reparsed source=${draftRecord.sourceMessageId}`);
    await this.renderDraftCard(draftId, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  private async safeParse(input: {
    sourceMessageId: string;
    attemptType: AiParseAttemptType;
    inputText: string;
    imageDataUrl?: string;
    conversationContext: Array<{ role: 'assistant' | 'user'; text: string }>;
    model: string;
    parsingPrompt: string;
    clarificationPrompt: string;
    defaultCurrency: string;
  }) {
    const categories = await this.loadActiveCategories();
    try {
      const aiParsed = await this.aiParsingService.parseTransaction({
        model: input.model,
        systemPrompt: input.parsingPrompt,
        clarificationPrompt: input.clarificationPrompt,
        categories: categories.map((item) => item.name),
        householdCurrency: input.defaultCurrency,
        currentDate: new Date().toISOString(),
        userInput: input.inputText,
        conversationContext: input.conversationContext,
        imageDataUrl: input.imageDataUrl,
      });

      const parsed = this.applyHeuristics(
        aiParsed,
        input.conversationContext.map((item) => item.text).concat(input.inputText).join('\n'),
        categories,
        input.defaultCurrency,
      );

      await this.recordParseAttempt(
        input.sourceMessageId,
        input.attemptType,
        input.model,
        `${input.parsingPrompt}\n\n${input.clarificationPrompt}`,
        parsed,
      );

      return parsed;
    } catch (error) {
      this.logger.error(`parse_failed source=${input.sourceMessageId}`, error);
      const fallback = this.applyHeuristics(
        {
          type: null,
          amount: null,
          occurredAt: null,
          categoryCandidate: null,
          comment: input.inputText || null,
          confidence: 0.1,
          ambiguities: ['type', 'amount', 'date', 'category'],
          followUpQuestion: null,
          resolvedCurrency: input.defaultCurrency,
        },
        input.inputText,
        categories,
        input.defaultCurrency,
      );
      await this.recordParseAttempt(
        input.sourceMessageId,
        input.attemptType,
        input.model,
        `${input.parsingPrompt}\n\nfallback`,
        fallback,
      );
      return fallback;
    }
  }

  private createDraftPayload(
    parsed: ParsedTransaction,
    inputText: string,
    defaultCurrency: string,
    categories: Array<{ id: string; name: string; type: CategoryType }>,
  ): Prisma.InputJsonValue {
    const normalizedCategoryName = this.normalizeCategoryCandidate(parsed.categoryCandidate, categories);
    const category = normalizedCategoryName
      ? categories.find((item) => item.name.toLowerCase() === normalizedCategoryName.toLowerCase())
      : null;

    const normalizedDate = this.normalizeDate(parsed.occurredAt);

    const draft: ReviewDraft = {
      type: parsed.type,
      amount: parsed.amount,
      occurredAt: normalizedDate ?? new Date().toISOString(),
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      comment: parsed.comment ?? inputText ?? null,
      currency: parsed.resolvedCurrency ?? defaultCurrency,
      confidence: parsed.confidence,
      ambiguities: parsed.ambiguities,
      followUpQuestion: parsed.followUpQuestion ?? null,
      sourceText: inputText,
    };

    return draft as unknown as Prisma.InputJsonValue;
  }

  private mergeDraftWithParsed(
    currentDraft: ReviewDraft,
    parsed: ParsedTransaction,
    inputText: string,
    defaultCurrency: string,
    categories: Array<{ id: string; name: string; type: CategoryType }>,
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

  private normalizeDate(value: string | null) {
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

  private applyHeuristics(
    parsed: ParsedTransaction,
    text: string,
    categories: Array<{ id: string; name: string; type: CategoryType }>,
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
        [/(такси|метро|автобус|транспорт|uber|яндекс go)/, 'Транспорт'],
        [/(lidl|aldi|kaufland|spar|tesco|ашан|пятерочк|перекрест|магнит|дикси|продукт|еда|магазин|кофе|ресторан)/, 'Продукты'],
        [/(дом|квартир|аренд|жкх)/, 'Дом'],
        [/(врач|аптек|лекарств|здоров)/, 'Здоровье'],
        [/(зарплат|доход|преми|гонорар)/, 'Доход'],
      ];
      for (const [pattern, categoryName] of hints) {
        if (
          pattern.test(normalized) &&
          categories.some(
            (item) =>
              item.name === categoryName &&
              (!next.type || item.type === (next.type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE)),
          )
        ) {
          next.categoryCandidate = categoryName;
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

  private normalizeCategoryCandidate(
    categoryCandidate: string | null,
    categories: Array<{ id: string; name: string; type: CategoryType }>,
  ) {
    if (!categoryCandidate) {
      return null;
    }

    const normalizedCandidate = categoryCandidate.trim().toLowerCase();
    const match = categories.find((item) => item.name.trim().toLowerCase() === normalizedCandidate);
    return match?.name ?? null;
  }

  private async beginFieldEdit(draftId: string, field: string, chatId: string) {
    if (field === 'type') {
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { pendingField: null },
      });
      await this.sendTelegramMessage(chatId, 'Выберите тип операции:', {
        inline_keyboard: [[
          { text: 'Доход', callback_data: 'draft:set-type:income' },
          { text: 'Расход', callback_data: 'draft:set-type:expense' },
        ]],
      });
      return { accepted: true, status: 'editing_type' };
    }

    if (field === 'category') {
      const draft = await this.loadDraft(draftId);
      const categoryType = draft.type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE;
      const categories = await this.prisma.category.findMany({
        where: {
          householdId: BOOTSTRAP_HOUSEHOLD_ID,
          isActive: true,
          ...(draft.type ? { type: categoryType } : {}),
        },
        orderBy: { name: 'asc' },
      });
      const keyboard = categories.slice(0, 8).map((item) => [
        { text: item.name, callback_data: `draft:set-category:${item.id}` },
      ]);
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { pendingField: null },
      });
      await this.sendTelegramMessage(chatId, 'Выберите категорию:', {
        inline_keyboard: keyboard,
      });
      return { accepted: true, status: 'editing_category' };
    }

    const prompts: Record<string, string> = {
      amount: 'Введите новую сумму.',
      date: 'Введите новую дату. Можно написать "сегодня" или "2026-03-31".',
      comment: 'Введите новый комментарий.',
    };

    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: { pendingField: field },
    });
    await this.sendTelegramMessage(chatId, prompts[field] ?? 'Введите новое значение.');
    return { accepted: true, status: 'awaiting_edit' };
  }

  private async applyManualEdit(
    draftId: string,
    field: string,
    value: string,
    chatId: string,
  ) {
    const draft = await this.loadDraft(draftId);
    if (field === 'amount') {
      const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
      draft.amount = match ? Number(match[0]) : null;
    }
    if (field === 'date') {
      draft.occurredAt = this.normalizeDate(value);
    }
    if (field === 'comment') {
      draft.comment = value;
    }

    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        draft: draft as unknown as Prisma.InputJsonValue,
        pendingField: null,
      },
    });

    await this.renderDraftCard(draftId, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  private async updateDraftField(
    draftId: string,
    patch: Partial<ReviewDraft>,
    chatId: string,
  ) {
    const draft = await this.loadDraft(draftId);
    const nextDraft = { ...draft, ...patch };
    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        draft: nextDraft as unknown as Prisma.InputJsonValue,
        pendingField: null,
      },
    });
    await this.renderDraftCard(draftId, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  private async confirmDraft(draftId: string, chatId: string, messageId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
      include: {
        sourceMessage: true,
      },
    });
    const draft = review.draft as unknown as ReviewDraft;
    const missing = this.getMissingDraftFields(draft);

    if (missing.length > 0) {
      await this.sendTelegramMessage(chatId, `Перед подтверждением нужно заполнить: ${missing.join(', ')}.`);
      await this.renderDraftCard(draftId, chatId);
      return { accepted: true, status: 'missing_fields' };
    }

    const category = await this.prisma.category.findUnique({ where: { id: draft.categoryId! } });
    if (!category) {
      await this.sendTelegramMessage(chatId, 'Категория не найдена. Выберите заново.');
      return { accepted: true, status: 'invalid_category' };
    }

    const txType = draft.type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE;
    if (
      (txType === TransactionType.INCOME && category.type !== CategoryType.INCOME) ||
      (txType === TransactionType.EXPENSE && category.type !== CategoryType.EXPENSE)
    ) {
      await this.sendTelegramMessage(chatId, 'Категория не соответствует типу операции.');
      return { accepted: true, status: 'invalid_category_type' };
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        authorId: review.authorId,
        categoryId: draft.categoryId!,
        sourceMessageId: review.sourceMessageId,
        type: txType,
        amount: new Decimal(draft.amount!),
        currency: draft.currency ?? (await this.settingsService.getSettings()).defaultCurrency,
        occurredAt: new Date(draft.occurredAt!),
        comment: draft.comment,
        status: TransactionStatus.CONFIRMED,
      },
    });

    await this.prisma.sourceMessage.update({
      where: { id: review.sourceMessageId },
      data: { status: SourceMessageStatus.PARSED },
    });

    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        status: SourceMessageStatus.PARSED,
        lastBotMessageId: messageId,
        pendingField: null,
      },
    });

    this.logger.log(`draft_confirmed transaction=${transaction.id}`);
    const updated = await this.editTelegramMessage(
      chatId,
      Number(messageId),
      this.renderDraftText(draft, true),
    );
    if (!updated) {
      await this.sendTelegramMessage(chatId, this.renderDraftText(draft, true));
    }
    return { accepted: true, status: 'confirmed', transactionId: transaction.id };
  }

  private async renderDraftCard(draftId: string, chatId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
    const draft = review.draft as unknown as ReviewDraft;
    const text = this.renderDraftText(draft, false);
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Подтвердить', callback_data: 'draft:confirm' },
          { text: 'Отменить', callback_data: 'draft:cancel' },
        ],
        [
          { text: 'Изменить тип', callback_data: 'draft:edit:type' },
          { text: 'Изменить сумму', callback_data: 'draft:edit:amount' },
        ],
        [
          { text: 'Изменить дату', callback_data: 'draft:edit:date' },
          { text: 'Изменить категорию', callback_data: 'draft:edit:category' },
        ],
        [{ text: 'Изменить комментарий', callback_data: 'draft:edit:comment' }],
      ],
    };

    if (review.lastBotMessageId) {
      await this.editTelegramMessage(chatId, Number(review.lastBotMessageId), text, keyboard);
    } else {
      const result = await this.sendTelegramMessage(chatId, text, keyboard);
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { lastBotMessageId: String(result.message_id) },
      });
    }
  }

  private renderDraftText(draft: ReviewDraft, confirmed: boolean) {
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

  private renderDraftSummary(draft: ReviewDraft) {
    return [
      `тип ${draft.type ?? 'не определен'}`,
      `сумма ${draft.amount ?? 'не определена'} ${draft.currency ?? ''}`.trim(),
      `дата ${draft.occurredAt ? format(new Date(draft.occurredAt), 'dd.MM.yyyy') : 'не определена'}`,
      `категория ${draft.categoryName ?? 'не определена'}`,
      `комментарий ${draft.comment ?? 'не определен'}`,
    ].join(', ');
  }

  private getMissingDraftFields(draft: ReviewDraft) {
    return [
      !draft.type ? 'тип' : null,
      !draft.amount ? 'сумма' : null,
      !draft.occurredAt ? 'дата' : null,
      !draft.categoryId ? 'категория' : null,
    ].filter((value): value is string => Boolean(value));
  }

  private async loadDraft(draftId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
    return review.draft as unknown as ReviewDraft;
  }

  private async cancelDraft(draftId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        status: SourceMessageStatus.CANCELLED,
        pendingField: null,
      },
    });
    await this.prisma.sourceMessage.update({
      where: { id: review.sourceMessageId },
      data: { status: SourceMessageStatus.CANCELLED },
    });
  }

  private async recordParseAttempt(
    sourceMessageId: string,
    attemptType: AiParseAttemptType,
    model: string,
    prompt: string,
    parsed: ParsedTransaction,
  ) {
    await this.prisma.aiParseAttempt.create({
      data: {
        sourceMessageId,
        attemptType,
        provider: 'polza.ai',
        model,
        prompt,
        responsePayload: parsed as Prisma.InputJsonValue,
        success: true,
      },
    });
  }

  private readConversation(value: Prisma.JsonValue | null): ConversationEntry[] {
    if (!value || !Array.isArray(value)) {
      return [];
    }
    return value as unknown as ConversationEntry[];
  }

  private isCancelCommand(text: string) {
    return ['отмена', 'стоп', 'cancel', '/cancel'].includes(text.trim().toLowerCase());
  }

  private async loadActiveCategories(type?: 'income' | 'expense' | null) {
    return this.prisma.category.findMany({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        isActive: true,
        ...(type
          ? {
              type: type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE,
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  private async upsertTelegramUser(message: TelegramMessage) {
    const from = message.from;
    const telegramId = String(from?.id ?? `chat-${message.chat.id}`);
    const account = await this.prisma.telegramAccount.findUnique({
      where: { telegramId },
      include: { user: true },
    });

    if (account?.user) {
      return account.user;
    }

    return this.prisma.user.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        displayName:
          [from?.first_name, from?.last_name].filter(Boolean).join(' ') ||
          from?.username ||
          `Telegram ${telegramId}`,
        role: UserRole.MEMBER,
        telegramAccounts: {
          create: {
            telegramId,
            username: from?.username,
            firstName: from?.first_name,
            lastName: from?.last_name,
          },
        },
      },
    });
  }

  private async persistAttachments(message: TelegramMessage, sourceMessageId: string) {
    const fileId = message.document?.file_id ?? message.photo?.at(-1)?.file_id;
    if (!fileId) {
      return [];
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return [];
    }

    const fileMeta = await this.requestTelegramApi<{
      ok: boolean;
      result: { file_path: string };
    }>(
      {
        method: 'GET',
        url: `https://api.telegram.org/bot${token}/getFile`,
        params: { file_id: fileId },
      },
      'telegram_get_file',
      'Telegram getFile request failed',
      { sourceMessageId, fileId },
    );

    const filePath = fileMeta.data.result.file_path;

    const attachment = await this.prisma.attachment.create({
      data: {
        sourceMessageId,
        telegramFileId: fileId,
        telegramFilePath: filePath,
        mimeType: message.document?.mime_type,
        originalName: message.document?.file_name,
        localPath: null,
      },
    });

    return [attachment];
  }

  private async buildAttachmentDataUrl(
    telegramFileId?: string | null,
    telegramFilePath?: string | null,
    mimeType?: string | null,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !telegramFileId) {
      return undefined;
    }

    const filePath = telegramFilePath ?? await this.resolveTelegramFilePath(telegramFileId);
    const fileResponse = await this.requestTelegramApi<ArrayBuffer>(
      {
        method: 'GET',
        url: `https://api.telegram.org/file/bot${token}/${filePath}`,
        responseType: 'arraybuffer',
      },
      'telegram_download_file',
      'Telegram file download failed',
      { telegramFileId, filePath },
    );
    const fileBuffer = Buffer.from(fileResponse.data);
    const resolvedMimeType = mimeType || this.detectMimeType(filePath);
    return `data:${resolvedMimeType};base64,${fileBuffer.toString('base64')}`;
  }

  private async resolveTelegramFilePath(fileId: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const fileMeta = await this.requestTelegramApi<{
      ok: boolean;
      result: { file_path: string };
    }>(
      {
        method: 'GET',
        url: `https://api.telegram.org/bot${token}/getFile`,
        params: { file_id: fileId },
      },
      'telegram_resolve_file_path',
      'Telegram file path resolution failed',
      { fileId },
    );

    return fileMeta.data.result.file_path;
  }

  private detectMimeType(filePath: string) {
    const normalized = filePath.toLowerCase();
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }

  private isRetriableTelegramNetworkError(error: unknown) {
    if (!axios.isAxiosError(error) || error.response) {
      return false;
    }

    return ['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes(
      error.code ?? '',
    );
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async requestTelegramApi<T>(
    config: AxiosRequestConfig,
    event: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= this.telegramRequestRetries;
      attempt += 1
    ) {
      try {
        return await axios.request<T>(config);
      } catch (error) {
        lastError = error;

        if (
          !this.isRetriableTelegramNetworkError(error) ||
          attempt === this.telegramRequestRetries
        ) {
          throw error;
        }

        const delayMs = this.telegramRequestBaseDelayMs * attempt;
        this.loggingService.warn(
          'telegram',
          `${event}_retry_scheduled`,
          `${message}; retry scheduled`,
          {
            ...context,
            attempt,
            delayMs,
            errorCode: axios.isAxiosError(error) ? error.code : undefined,
          },
        );
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  private async sendTelegramMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { message_id: 0 };
    }

    const response = await this.requestTelegramApi<{ result: { message_id: number } }>(
      {
        method: 'POST',
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        data: {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        },
      },
      'telegram_send_message',
      'Telegram sendMessage failed',
      { chatId },
    );

    return response.data.result as { message_id: number };
  }

  private async editTelegramMessage(
    chatId: string,
    messageId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;

    try {
        await this.requestTelegramApi(
          {
            method: 'POST',
            url: `https://api.telegram.org/bot${token}/editMessageText`,
            data: {
              chat_id: chatId,
              message_id: messageId,
              text,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            },
          },
          'telegram_edit_message',
          'Telegram editMessageText failed',
          { chatId, messageId },
        );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const description = error.response?.data?.description;
        if (
          typeof description === 'string' &&
          description.includes('message is not modified')
        ) {
          this.logger.debug(`telegram_message_not_modified chat=${chatId} message=${messageId}`);
          return true;
        }
        this.logger.error(
          `telegram_edit_message_failed chat=${chatId} message=${messageId} code=${error.code ?? 'unknown'} description=${description ?? 'n/a'}`,
        );
        return false;
      }
      this.logger.error('telegram_edit_message_failed', error);
      return false;
    }
  }

  private async answerCallbackQuery(callbackQueryId: string, text?: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    try {
        await this.requestTelegramApi(
          {
            method: 'POST',
            url: `https://api.telegram.org/bot${token}/answerCallbackQuery`,
            data: {
              callback_query_id: callbackQueryId,
              ...(text ? { text } : {}),
            },
          },
          'telegram_answer_callback',
          'Telegram answerCallbackQuery failed',
          { callbackQueryId },
        );
    } catch (error) {
      this.logger.error('telegram_answer_callback_failed', error);
    }
  }
}
