import { Injectable } from '@nestjs/common';
import {
  CategoryType,
  SourceMessageStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ReviewDraft } from '../telegram/telegram.types';

@Injectable()
export class TransactionCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly householdContext: HouseholdContextService,
  ) {}

  async ensureCategoryType(
    categoryId: string,
    type: 'income' | 'expense',
  ) {
    const category = await this.prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
    });

    const expected =
      type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE;
    if (category.type !== expected) {
      throw new Error('Category type does not match transaction type');
    }

    return category;
  }

  async createConfirmedFromDraft(input: {
    reviewId: string;
    sourceMessageId: string;
    authorId: string | null;
    draft: ReviewDraft;
  }) {
    await this.ensureCategoryType(input.draft.categoryId!, input.draft.type!);
    const settings = await this.settingsService.getSettings();

    const transaction = await this.prisma.transaction.create({
      data: {
        householdId: this.householdContext.getHouseholdId(),
        authorId: input.authorId,
        categoryId: input.draft.categoryId!,
        sourceMessageId: input.sourceMessageId,
        type: input.draft.type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
        amount: new Decimal(input.draft.amount!),
        currency: input.draft.currency ?? settings.defaultCurrency,
        occurredAt: new Date(input.draft.occurredAt!),
        comment: input.draft.comment,
        status: TransactionStatus.CONFIRMED,
      },
    });

    await this.prisma.sourceMessage.update({
      where: { id: input.sourceMessageId },
      data: { status: SourceMessageStatus.PARSED },
    });

    await this.prisma.pendingOperationReview.update({
      where: { id: input.reviewId },
      data: {
        status: SourceMessageStatus.PARSED,
        pendingField: null,
      },
    });

    return transaction;
  }
}
