import { Injectable } from '@nestjs/common';
import { Prisma, SourceMessageStatus, SourceMessageType, UserRole } from '@prisma/client';
import { HouseholdContextService } from '../common/household-context.service';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentService } from './attachment.service';
import { ClarificationService } from './clarification.service';
import { DraftLifecycleService } from './draft-lifecycle.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import {
  createTelegramStatsSubmenuReplyMarkup,
  isTelegramAddOperationMenuAction,
  isTelegramSilentMenuAction,
  isTelegramStartCommand,
} from './telegram-menu';
import { TelegramMessage } from './telegram.types';

@Injectable()
export class MessageIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly householdContext: HouseholdContextService,
    private readonly loggingService: LoggingService,
    private readonly attachmentService: AttachmentService,
    private readonly draftLifecycleService: DraftLifecycleService,
    private readonly clarificationService: ClarificationService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
  ) {}

  async handleMessage(message: TelegramMessage, rawUpdate: Record<string, unknown>) {
    const author = await this.upsertTelegramUser(message);
    const chatId = String(message.chat.id);
    const text = (message.text ?? message.caption ?? '').trim();
    const hasAttachment = Boolean(message.photo?.length || message.document);

    if (isTelegramStartCommand(text)) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        'Привет! Отправьте сообщение с операцией или фото чека.',
      );
      return { accepted: true, status: 'menu_shown', authorId: author.id };
    }

    if (isTelegramAddOperationMenuAction(text)) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        'Отправьте сообщение с операцией или фото чека. Например: <b>Такси 12 EUR</b>.',
      );
      return { accepted: true, status: 'add_operation_prompt_shown', authorId: author.id };
    }

    if (isTelegramSilentMenuAction(text)) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        'Выберите отчет:',
        createTelegramStatsSubmenuReplyMarkup(),
      );
      return { accepted: true, status: 'stats_menu_shown', authorId: author.id };
    }

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
        await this.draftLifecycleService.cancelDraft(existingDraft.id, chatId);
        await this.telegramDeliveryService.sendTelegramMessage(
          chatId,
          'Предыдущий черновик закрыт. Обрабатываю новый чек как отдельную операцию.',
        );
      } else {
        if (this.telegramDraftService.isCancelCommand(text)) {
          await this.draftLifecycleService.cancelDraft(existingDraft.id, chatId);
          await this.telegramDeliveryService.sendTelegramMessage(
            chatId,
            'Черновик отменен. Можете отправить новую операцию.',
          );
          return { accepted: true, status: 'cancelled' };
        }

        if (existingDraft.pendingField) {
          return this.clarificationService.applyManualEdit(
            existingDraft.id,
            existingDraft.pendingField,
            text,
            chatId,
          );
        }

        return this.draftLifecycleService.reparseDraftWithClarification(
          existingDraft.id,
          text,
          chatId,
        );
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
        householdId: this.householdContext.getHouseholdId(),
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

    const attachments = await this.attachmentService.persistAttachments(message, sourceMessage.id);
    this.loggingService.info('telegram', 'message_received', 'Telegram message received', {
      sourceMessageId: sourceMessage.id,
      telegramMessageId: sourceMessage.telegramMessageId,
      authorId: author.id,
      hasAttachment,
    });
    return this.draftLifecycleService.createDraftFromMessage(
      sourceMessage.id,
      author.id,
      chatId,
      text,
      attachments,
    );
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
        householdId: this.householdContext.getHouseholdId(),
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
}
