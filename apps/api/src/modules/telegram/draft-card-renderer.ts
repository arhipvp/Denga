import { DraftReviewRepository } from './draft-review.repository';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { ReviewDraft } from './telegram.types';

export class DraftCardRenderer {
  constructor(
    private readonly reviewRepository: DraftReviewRepository,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
  ) {}

  async renderDraftCard(draftId: string, chatId: string) {
    const review = await this.reviewRepository.loadDraftRecord(draftId);
    const draft = review.draft as unknown as ReviewDraft;
    const text = this.telegramDraftService.renderDraftText(draft, false);
    if (review.activePickerMessageId) {
      await this.reviewRepository.updateDraftState(draftId, { activePickerMessageId: null });
    }
    await this.clearActivePickerMessage(chatId, review.activePickerMessageId);
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
      return;
    }

    const result = await this.telegramDeliveryService.sendTelegramMessage(chatId, text, keyboard);
    await this.reviewRepository.updateDraftState(draftId, {
      lastBotMessageId: String(result.message_id),
    });
  }

  async setActivePickerMessage(draftId: string, messageId: string | null) {
    await this.reviewRepository.updateDraftState(draftId, { activePickerMessageId: messageId });
  }

  async clearDraftActivePicker(draftId: string, chatId: string, fallbackMessageId?: number) {
    const review = await this.reviewRepository.loadDraftRecord(draftId);
    const targetMessageId = review.activePickerMessageId ?? String(fallbackMessageId ?? '');
    await this.reviewRepository.updateDraftState(draftId, { activePickerMessageId: null });
    await this.clearActivePickerMessage(chatId, targetMessageId);
  }

  async clearActivePickerMessage(
    chatId: string | null | undefined,
    messageId: string | null | undefined,
  ) {
    if (!chatId || !messageId) {
      return;
    }

    const numericMessageId = Number(messageId);
    if (!Number.isFinite(numericMessageId)) {
      return;
    }

    const deleted = await this.telegramDeliveryService.deleteTelegramMessage(
      chatId,
      numericMessageId,
    );

    if (!deleted) {
      await this.telegramDeliveryService.clearTelegramInlineKeyboard(
        chatId,
        numericMessageId,
      );
    }
  }
}
