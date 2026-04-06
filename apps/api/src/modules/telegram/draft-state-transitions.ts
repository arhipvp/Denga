import { Logger } from '@nestjs/common';
import { SourceMessageStatus } from '@prisma/client';
import { TransactionCoreService } from '../transaction/transaction-core.service';
import {
  DraftCancelResult,
  DraftConfirmResult,
} from './draft-lifecycle.types';
import { DraftCardRenderer } from './draft-card-renderer';
import { DraftReviewRepository } from './draft-review.repository';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { TransactionNotificationService } from './transaction-notification.service';
import { ReviewDraft } from './telegram.types';

function mapConfirmationError(error: unknown) {
  if (
    error instanceof Error &&
    error.message === 'Category type does not match transaction type'
  ) {
    return {
      message: 'Категория не соответствует типу операции.',
      status: 'invalid_category_type' as const,
    };
  }

  return {
    message: 'Категория не найдена. Выберите заново.',
    status: 'invalid_category' as const,
  };
}

export class DraftStateTransitions {
  constructor(
    private readonly reviewRepository: DraftReviewRepository,
    private readonly draftCardRenderer: DraftCardRenderer,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
    private readonly transactionCoreService: TransactionCoreService,
    private readonly transactionNotificationService: TransactionNotificationService,
    private readonly logger: Logger,
  ) {}

  async confirmDraft(
    draftId: string,
    chatId: string,
    messageId: string,
  ): Promise<DraftConfirmResult> {
    const review = await this.reviewRepository.loadDraftWithConfirmationContext(draftId);
    const draft = review.draft as unknown as ReviewDraft;
    const missing = this.telegramDraftService.getMissingDraftFields(draft);

    if (missing.length > 0) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        `Перед подтверждением нужно заполнить: ${missing.join(', ')}.`,
      );
      await this.draftCardRenderer.renderDraftCard(draftId, chatId);
      return { accepted: true, status: 'missing_fields' };
    }

    try {
      const transaction = await this.transactionCoreService.createConfirmedFromDraft({
        reviewId: draftId,
        sourceMessageId: review.sourceMessageId,
        authorId: review.authorId,
        draft,
      });

      await this.reviewRepository.updateDraftState(draftId, {
        lastBotMessageId: messageId,
        activePickerMessageId: null,
        pendingField: null,
      });

      this.logger.log(`draft_confirmed transaction=${transaction.id}`);
      await this.draftCardRenderer.clearActivePickerMessage(
        chatId,
        review.activePickerMessageId,
      );
      const text = this.telegramDraftService.renderDraftText(draft, true);
      const updated = await this.telegramDeliveryService.editTelegramMessage(
        chatId,
        Number(messageId),
        text,
      );
      if (!updated) {
        await this.telegramDeliveryService.sendTelegramMessage(chatId, text);
      }
      await this.transactionNotificationService.notifyTransactionCreated(transaction.id, {
        excludeTelegramIds:
          review.author?.telegramAccounts.map((item) => item.telegramId) ?? [],
      });
      return { accepted: true, status: 'confirmed', transactionId: transaction.id };
    } catch (error) {
      const failure = mapConfirmationError(error);
      await this.telegramDeliveryService.sendTelegramMessage(chatId, failure.message);
      return { accepted: true, status: failure.status };
    }
  }

  async cancelDraft(draftId: string, chatId?: string): Promise<DraftCancelResult> {
    const review = await this.reviewRepository.loadDraftRecord(draftId);
    await this.reviewRepository.updateDraftState(draftId, {
      status: SourceMessageStatus.CANCELLED,
      activePickerMessageId: null,
      pendingField: null,
    });
    await this.draftCardRenderer.clearActivePickerMessage(
      chatId,
      review.activePickerMessageId,
    );
    await this.reviewRepository.updateSourceMessageStatus(
      review.sourceMessageId,
      SourceMessageStatus.CANCELLED,
    );
    return { accepted: true, status: 'cancelled' };
  }
}
