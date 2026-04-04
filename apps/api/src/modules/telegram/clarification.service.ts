import { Injectable } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { DraftLifecycleService } from './draft-lifecycle.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { ReviewDraft, TelegramCallbackQuery } from './telegram.types';

@Injectable()
export class ClarificationService {
  private static readonly categoryPageSize = 8;
  private static readonly categoryPageCallbackPrefix = 'draft:category-page:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly householdContext: HouseholdContextService,
    private readonly draftLifecycleService: DraftLifecycleService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly telegramDraftService: TelegramDraftService,
  ) {}

  async handleCallbackQuery(callback: TelegramCallbackQuery) {
    const data = callback.data ?? '';
    const chatId = String(callback.message?.chat.id ?? callback.from.id);
    const messageId = String(callback.message?.message_id ?? '');
    const authorId = String(callback.from.id);
    const author = await this.prisma.telegramAccount.findUnique({
      where: { telegramId: authorId },
      include: { user: true },
    });

    if (!author?.user) {
      await this.telegramDeliveryService.answerCallbackQuery(callback.id, 'Пользователь не найден');
      return { accepted: true, ignored: true };
    }

    const draft = await this.prisma.pendingOperationReview.findFirst({
      where: {
        authorId: author.user.id,
        status: 'PENDING_REVIEW',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!draft) {
      await this.telegramDeliveryService.answerCallbackQuery(callback.id, 'Активный черновик не найден');
      return { accepted: true, ignored: true };
    }

    if (data === 'draft:confirm') {
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      return this.draftLifecycleService.confirmDraft(draft.id, chatId, messageId);
    }

    if (data === 'draft:cancel') {
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      await this.draftLifecycleService.cancelDraft(draft.id);
      await this.telegramDeliveryService.editTelegramMessage(chatId, Number(messageId), 'Операция отменена.');
      return { accepted: true, status: 'cancelled' };
    }

    if (data.startsWith('draft:edit:')) {
      const field = data.replace('draft:edit:', '');
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      return this.beginFieldEdit(draft.id, field, chatId);
    }

    if (data.startsWith('draft:set-type:')) {
      const value = data.replace('draft:set-type:', '') as 'income' | 'expense';
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      return this.updateDraftField(draft.id, { type: value, categoryId: null, categoryName: null }, chatId);
    }

    if (data.startsWith('draft:set-category:')) {
      const categoryId = data.replace('draft:set-category:', '');
      const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
      if (!category) {
        await this.telegramDeliveryService.answerCallbackQuery(callback.id, 'Категория не найдена');
        return { accepted: true, ignored: true };
      }
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      return this.updateDraftField(
        draft.id,
        { categoryId: category.id, categoryName: category.name },
        chatId,
      );
    }

    if (data.startsWith(ClarificationService.categoryPageCallbackPrefix)) {
      const page = Number(
        data.replace(ClarificationService.categoryPageCallbackPrefix, ''),
      );
      await this.telegramDeliveryService.answerCallbackQuery(callback.id);
      return this.showCategoryPage(
        draft.id,
        chatId,
        Number(messageId),
        Number.isFinite(page) ? page : 0,
      );
    }

    await this.telegramDeliveryService.answerCallbackQuery(callback.id, 'Неизвестное действие');
    return { accepted: true, ignored: true };
  }

  async beginFieldEdit(draftId: string, field: string, chatId: string) {
    if (field === 'type') {
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { pendingField: null },
      });
      await this.telegramDeliveryService.sendTelegramMessage(chatId, 'Выберите тип операции:', {
        inline_keyboard: [[
          { text: 'Доход', callback_data: 'draft:set-type:income' },
          { text: 'Расход', callback_data: 'draft:set-type:expense' },
        ]],
      });
      return { accepted: true, status: 'editing_type' };
    }

    if (field === 'category') {
      await this.prisma.pendingOperationReview.update({
        where: { id: draftId },
        data: { pendingField: null },
      });
      return this.showCategoryPicker(draftId, chatId);
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
    await this.telegramDeliveryService.sendTelegramMessage(chatId, prompts[field] ?? 'Введите новое значение.');
    return { accepted: true, status: 'awaiting_edit' };
  }

  async applyManualEdit(
    draftId: string,
    field: string,
    value: string,
    chatId: string,
  ) {
    const draft = await this.draftLifecycleService.loadDraft(draftId);
    if (field === 'amount') {
      const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
      draft.amount = match ? Number(match[0]) : null;
    }
    if (field === 'date') {
      draft.occurredAt = this.telegramDraftService.normalizeDate(value);
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

    await this.draftLifecycleService.renderDraftCard(draftId, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  async updateDraftField(
    draftId: string,
    patch: Partial<ReviewDraft>,
    chatId: string,
  ) {
    const draft = await this.draftLifecycleService.loadDraft(draftId);
    const nextDraft = { ...draft, ...patch };
    await this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        draft: nextDraft as unknown as Prisma.InputJsonValue,
        pendingField: null,
      },
    });
    await this.draftLifecycleService.renderDraftCard(draftId, chatId);
    return { accepted: true, status: 'pending_review' };
  }

  private async showCategoryPicker(draftId: string, chatId: string) {
    const categoryPage = await this.buildCategoryPagePayload(draftId, 0);

    if (!categoryPage) {
      await this.telegramDeliveryService.sendTelegramMessage(
        chatId,
        'Нет активных категорий для выбранного типа операции.',
      );
      return { accepted: true, status: 'editing_category_empty' };
    }

    await this.telegramDeliveryService.sendTelegramMessage(
      chatId,
      categoryPage.text,
      categoryPage.replyMarkup,
    );
    return { accepted: true, status: 'editing_category' };
  }

  private async showCategoryPage(
    draftId: string,
    chatId: string,
    messageId: number,
    requestedPage: number,
  ) {
    const categoryPage = await this.buildCategoryPagePayload(draftId, requestedPage);

    if (!categoryPage) {
      await this.telegramDeliveryService.editTelegramMessage(
        chatId,
        messageId,
        'Нет активных категорий для выбранного типа операции.',
      );
      return { accepted: true, status: 'editing_category_empty' };
    }

    await this.telegramDeliveryService.editTelegramMessage(
      chatId,
      messageId,
      categoryPage.text,
      categoryPage.replyMarkup,
    );
    return { accepted: true, status: 'editing_category' };
  }

  private async buildCategoryPagePayload(draftId: string, requestedPage: number) {
    const categories = await this.loadDraftCategories(draftId);
    if (categories.length === 0) {
      return null;
    }

    const totalPages = Math.ceil(
      categories.length / ClarificationService.categoryPageSize,
    );
    const currentPage = Math.min(
      Math.max(0, requestedPage),
      totalPages - 1,
    );
    const startIndex = currentPage * ClarificationService.categoryPageSize;
    const pageItems = categories.slice(
      startIndex,
      startIndex + ClarificationService.categoryPageSize,
    );
    const keyboard = pageItems.map((item) => [
      { text: item.name, callback_data: `draft:set-category:${item.id}` },
    ]);
    const paginationRow = [
      ...(currentPage > 0
        ? [
            {
              text: 'Назад',
              callback_data: `${ClarificationService.categoryPageCallbackPrefix}${currentPage - 1}`,
            },
          ]
        : []),
      ...(currentPage < totalPages - 1
        ? [
            {
              text: 'Вперед',
              callback_data: `${ClarificationService.categoryPageCallbackPrefix}${currentPage + 1}`,
            },
          ]
        : []),
    ];

    if (paginationRow.length > 0) {
      keyboard.push(paginationRow);
    }

    return {
      text:
        totalPages > 1
          ? `Выберите категорию (страница ${currentPage + 1}/${totalPages}):`
          : 'Выберите категорию:',
      replyMarkup: {
        inline_keyboard: keyboard,
      },
    };
  }

  private async loadDraftCategories(draftId: string) {
    const draft = await this.draftLifecycleService.loadDraft(draftId);
    const categoryType = draft.type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE;

    return this.prisma.category.findMany({
      where: {
        householdId: this.householdContext.getHouseholdId(),
        isActive: true,
        ...(draft.type ? { type: categoryType } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
