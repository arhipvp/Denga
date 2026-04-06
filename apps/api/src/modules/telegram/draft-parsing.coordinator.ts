import { AiParseAttemptType, Prisma, SourceMessageStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { HouseholdContextService } from '../common/household-context.service';
import { SettingsService } from '../settings/settings.service';
import { AttachmentService } from './attachment.service';
import { DraftCreateResult, DraftReparseResult } from './draft-lifecycle.types';
import { DraftCardRenderer } from './draft-card-renderer';
import { DraftReviewRepository } from './draft-review.repository';
import { ParsedTransaction, AiParsingService } from './services/ai-parsing.service';
import { TelegramDraftService } from './telegram-draft.service';
import { ReviewDraft } from './telegram.types';

export class DraftParsingCoordinator {
  constructor(
    private readonly reviewRepository: DraftReviewRepository,
    private readonly settingsService: SettingsService,
    private readonly aiParsingService: AiParsingService,
    private readonly householdContext: HouseholdContextService,
    private readonly attachmentService: AttachmentService,
    private readonly telegramDraftService: TelegramDraftService,
    private readonly draftCardRenderer: DraftCardRenderer,
    private readonly logger: Logger,
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
  ): Promise<DraftCreateResult> {
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

    const categories = await this.reviewRepository.loadActiveCategories(
      this.householdContext.getHouseholdId(),
      parsed.type,
    );
    const draft = await this.reviewRepository.createDraftReview({
      sourceMessageId,
      authorId,
      draft: this.telegramDraftService.createDraftPayload(
        parsed,
        inputText,
        settings.defaultCurrency,
        categories,
      ) as unknown as ReviewDraft,
    });

    await this.reviewRepository.updateSourceMessageStatus(
      sourceMessageId,
      SourceMessageStatus.PENDING_REVIEW,
    );

    this.logger.log(`draft_created source=${sourceMessageId}`);
    await this.draftCardRenderer.renderDraftCard(draft.id, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  async reparseDraftWithClarification(
    draftId: string,
    userText: string,
    chatId: string,
  ): Promise<DraftReparseResult> {
    const draftRecord = await this.reviewRepository.loadDraftWithSourceContext(draftId);
    const settings = await this.settingsService.getSettings();
    const currentDraft = draftRecord.draft as Parameters<
      TelegramDraftService['mergeDraftWithParsed']
    >[0];
    const firstAttachment = draftRecord.sourceMessage.attachments[0];
    const parsed = await this.safeParse({
      sourceMessageId: draftRecord.sourceMessageId,
      attemptType: AiParseAttemptType.CLARIFICATION_REPARSE,
      inputText: userText,
      imageDataUrl: firstAttachment
        ? await this.attachmentService.buildAttachmentDataUrl(
            firstAttachment.telegramFileId,
            firstAttachment.telegramFilePath,
            firstAttachment.mimeType,
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

    const categories = await this.reviewRepository.loadActiveCategories(
      this.householdContext.getHouseholdId(),
      parsed.type,
    );
    const nextDraft = this.telegramDraftService.mergeDraftWithParsed(
      currentDraft,
      parsed,
      userText,
      settings.defaultCurrency,
      categories,
    );

    await this.reviewRepository.updateDraftPayload(draftId, nextDraft, {
      activePickerMessageId: null,
      pendingField: null,
    });

    this.logger.log(`draft_reparsed source=${draftRecord.sourceMessageId}`);
    await this.draftCardRenderer.renderDraftCard(draftId, chatId);
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
    const categories = await this.reviewRepository.loadActiveCategories(
      this.householdContext.getHouseholdId(),
    );
    const parseRequest = {
      model: input.model,
      systemPrompt: input.parsingPrompt,
      clarificationPrompt: input.clarificationPrompt,
      categories: categories.map((item) => item.name),
      householdCurrency: input.defaultCurrency,
      currentDate: new Date().toISOString(),
      userInput: input.inputText,
      conversationContext: input.conversationContext,
      imageDataUrl: input.imageDataUrl,
    };
    const promptSnapshot = this.aiParsingService.buildPromptSnapshot(parseRequest);

    try {
      const aiParsed = await this.aiParsingService.parseTransaction(parseRequest);
      const parsed = this.telegramDraftService.applyHeuristics(
        aiParsed,
        input.conversationContext.map((item) => item.text).concat(input.inputText).join('\n'),
        categories,
        input.defaultCurrency,
      );

      await this.reviewRepository.recordParseAttempt(
        input.sourceMessageId,
        input.attemptType,
        input.model,
        promptSnapshot,
        parsed as Prisma.InputJsonValue,
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
      await this.reviewRepository.recordParseAttempt(
        input.sourceMessageId,
        input.attemptType,
        input.model,
        {
          ...promptSnapshot,
          fallback: true,
        },
        fallback as Prisma.InputJsonValue,
      );
      return fallback;
    }
  }
}
