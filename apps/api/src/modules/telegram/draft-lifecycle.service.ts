import { Injectable, Logger } from '@nestjs/common';
import { AiParseAttemptType, CategoryType, Prisma, SourceMessageStatus } from '@prisma/client';
import { HouseholdContextService } from '../common/household-context.service';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionCoreService } from '../transaction/transaction-core.service';
import { ParsedTransaction, AiParsingService } from './services/ai-parsing.service';
import { AttachmentService } from './attachment.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { ActiveCategory, ReviewDraft } from './telegram.types';

@Injectable()
export class DraftLifecycleService {
  private readonly logger = new Logger(DraftLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly aiParsingService: AiParsingService,
    private readonly loggingService: LoggingService,
    private readonly householdContext: HouseholdContextService,
    private readonly attachmentService: AttachmentService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
    private readonly transactionCoreService: TransactionCoreService,
  ) {}

  async createDraftFromMessage(
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
        ? await this.attachmentService.buildAttachmentDataUrl(
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
        draft: this.telegramDraftService.createDraftPayload(
          parsed,
          inputText,
          settings.defaultCurrency,
          categories,
        ),
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

  async confirmDraft(draftId: string, chatId: string, messageId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
      include: {
        sourceMessage: true,
      },
    });
    const draft = review.draft as unknown as ReviewDraft;
    const missing = this.telegramDraftService.getMissingDraftFields(draft);

    if (missing.length > 0) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        `Перед подтверждением нужно заполнить: ${missing.join(', ')}.`,
      );
      await this.renderDraftCard(draftId, chatId);
      return { accepted: true, status: 'missing_fields' };
    }

    try {
      const transaction = await this.transactionCoreService.createConfirmedFromDraft({
        reviewId: draftId,
        sourceMessageId: review.sourceMessageId,
        authorId: review.authorId,
        draft,
      });

      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: {
          lastBotMessageId: messageId,
          pendingField: null,
        },
      });

      this.logger.log(`draft_confirmed transaction=${transaction.id}`);
      const text = this.telegramDraftService.renderDraftText(draft, true);
      const updated = await this.telegramDeliveryService.editTelegramMessage(
        chatId,
        Number(messageId),
        text,
      );
      if (!updated) {
        await this.telegramDeliveryService.sendTelegramMessage(chatId, text);
      }
      return { accepted: true, status: 'confirmed', transactionId: transaction.id };
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'Category type does not match transaction type'
          ? 'Категория не соответствует типу операции.'
          : 'Категория не найдена. Выберите заново.';
      await this.telegramDeliveryService.sendTelegramMessage(chatId, message);
      return {
        accepted: true,
        status: message.includes('соответствует') ? 'invalid_category_type' : 'invalid_category',
      };
    }
  }

  async renderDraftCard(draftId: string, chatId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
    const draft = review.draft as unknown as ReviewDraft;
    const text = this.telegramDraftService.renderDraftText(draft, false);
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
      await this.telegramDeliveryService.editTelegramMessage(
        chatId,
        Number(review.lastBotMessageId),
        text,
        keyboard,
      );
    } else {
      const result = await this.telegramDeliveryService.sendTelegramMessage(chatId, text, keyboard);
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { lastBotMessageId: String(result.message_id) },
      });
    }
  }

  async cancelDraft(draftId: string) {
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

  async loadDraft(draftId: string) {
    const review = await this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
    return review.draft as unknown as ReviewDraft;
  }

  async loadActiveCategories(type?: 'income' | 'expense' | null): Promise<ActiveCategory[]> {
    return this.prisma.category.findMany({
      where: {
        householdId: this.householdContext.getHouseholdId(),
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

      const parsed = this.telegramDraftService.applyHeuristics(
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
      const fallback = this.telegramDraftService.applyHeuristics(
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

  async reparseDraftWithClarification(draftId: string, userText: string, chatId: string) {
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
    const parsed = await this.safeParse({
      sourceMessageId: draftRecord.sourceMessageId,
      attemptType: AiParseAttemptType.CLARIFICATION_REPARSE,
      inputText: userText,
      imageDataUrl: draftRecord.sourceMessage.attachments[0]
        ? await this.attachmentService.buildAttachmentDataUrl(
            draftRecord.sourceMessage.attachments[0].telegramFileId,
            draftRecord.sourceMessage.attachments[0].telegramFilePath,
            draftRecord.sourceMessage.attachments[0].mimeType,
          )
        : undefined,
      conversationContext: [
        {
          role: 'assistant' as const,
          text:
            currentDraft.followUpQuestion ??
            `Текущий черновик: ${this.telegramDraftService.renderDraftSummary(currentDraft)}.`,
        },
        { role: 'user' as const, text: userText },
      ],
      model: settings.aiModel,
      parsingPrompt: settings.parsingPrompt,
      clarificationPrompt: settings.clarificationPrompt,
      defaultCurrency: settings.defaultCurrency,
    });

    const categories = await this.loadActiveCategories(parsed.type);
    const nextDraft = this.telegramDraftService.mergeDraftWithParsed(
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
}
