import { Injectable, Logger } from '@nestjs/common';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionCoreService } from '../transaction/transaction-core.service';
import { AttachmentService } from './attachment.service';
import { DraftCardRenderer } from './draft-card-renderer';
import {
  DraftActionResult,
  DraftConfirmResult,
} from './draft-lifecycle.types';
import { DraftParsingCoordinator } from './draft-parsing.coordinator';
import { DraftReviewRepository } from './draft-review.repository';
import { DraftStateTransitions } from './draft-state-transitions';
import { AiParsingService } from './services/ai-parsing.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { TransactionNotificationService } from './transaction-notification.service';
import { ActiveCategory, ReviewDraft } from './telegram.types';

@Injectable()
export class DraftLifecycleService {
  private readonly logger = new Logger(DraftLifecycleService.name);
  private readonly reviewRepository: DraftReviewRepository;
  private readonly draftCardRenderer: DraftCardRenderer;
  private readonly draftParsingCoordinator: DraftParsingCoordinator;
  private readonly draftStateTransitions: DraftStateTransitions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly aiParsingService: AiParsingService,
    private readonly householdContext: HouseholdContextService,
    private readonly attachmentService: AttachmentService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
    private readonly transactionCoreService: TransactionCoreService,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {
    this.reviewRepository = new DraftReviewRepository(this.prisma);
    this.draftCardRenderer = new DraftCardRenderer(
      this.reviewRepository,
      this.telegramDeliveryService,
      this.telegramDraftService,
    );
    this.draftParsingCoordinator = new DraftParsingCoordinator(
      this.reviewRepository,
      this.settingsService,
      this.aiParsingService,
      this.householdContext,
      this.attachmentService,
      this.telegramDraftService,
      this.draftCardRenderer,
      this.logger,
    );
    this.draftStateTransitions = new DraftStateTransitions(
      this.reviewRepository,
      this.draftCardRenderer,
      this.telegramDeliveryService,
      this.telegramDraftService,
      this.transactionCoreService,
      this.transactionNotificationService,
      this.logger,
    );
  }

  createDraftFromMessage(
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
    return this.draftParsingCoordinator.createDraftFromMessage(
      sourceMessageId,
      authorId,
      chatId,
      inputText,
      attachments,
    );
  }

  confirmDraft(
    draftId: string,
    chatId: string,
    messageId: string,
  ): Promise<DraftConfirmResult> {
    return this.draftStateTransitions.confirmDraft(draftId, chatId, messageId);
  }

  renderDraftCard(draftId: string, chatId: string) {
    return this.draftCardRenderer.renderDraftCard(draftId, chatId);
  }

  cancelDraft(draftId: string, chatId?: string) {
    return this.draftStateTransitions.cancelDraft(draftId, chatId);
  }

  async loadDraft(draftId: string) {
    const review = await this.reviewRepository.loadDraftRecord(draftId);
    return review.draft as unknown as ReviewDraft;
  }

  setActivePickerMessage(draftId: string, messageId: string | null) {
    return this.draftCardRenderer.setActivePickerMessage(draftId, messageId);
  }

  clearDraftActivePicker(draftId: string, chatId: string, fallbackMessageId?: number) {
    return this.draftCardRenderer.clearDraftActivePicker(
      draftId,
      chatId,
      fallbackMessageId,
    );
  }

  loadActiveCategories(type?: 'income' | 'expense' | null): Promise<ActiveCategory[]> {
    return this.reviewRepository.loadActiveCategories(
      this.householdContext.getHouseholdId(),
      type,
    );
  }

  reparseDraftWithClarification(draftId: string, userText: string, chatId: string) {
    return this.draftParsingCoordinator.reparseDraftWithClarification(
      draftId,
      userText,
      chatId,
    );
  }

  async runAction<T extends DraftActionResult>(action: () => Promise<T>) {
    return action();
  }
}
