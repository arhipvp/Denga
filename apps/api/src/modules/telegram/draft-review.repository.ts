import { AiParseAttemptType, CategoryType, Prisma, SourceMessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveCategory, ReviewDraft } from './telegram.types';

export class DraftReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  createDraftReview(input: {
    sourceMessageId: string;
    authorId: string;
    draft: ReviewDraft;
  }) {
    return this.prisma.pendingOperationReview.create({
      data: {
        sourceMessageId: input.sourceMessageId,
        authorId: input.authorId,
        status: SourceMessageStatus.PENDING_REVIEW,
        draft: input.draft as unknown as Prisma.InputJsonValue,
      },
    });
  }

  loadDraftRecord(draftId: string) {
    return this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
    });
  }

  loadDraftWithConfirmationContext(draftId: string) {
    return this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
      include: {
        sourceMessage: true,
        author: {
          include: {
            telegramAccounts: {
              where: {
                isActive: true,
              },
              select: {
                telegramId: true,
              },
            },
          },
        },
      },
    });
  }

  loadDraftWithSourceContext(draftId: string) {
    return this.prisma.pendingOperationReview.findUniqueOrThrow({
      where: { id: draftId },
      include: {
        sourceMessage: {
          include: { attachments: true, parseAttempts: true },
        },
      },
    });
  }

  updateDraftState(
    draftId: string,
    data: Prisma.PendingOperationReviewUpdateInput,
  ) {
    return this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data,
    });
  }

  updateDraftPayload(
    draftId: string,
    draft: ReviewDraft,
    data?: Omit<Prisma.PendingOperationReviewUpdateInput, 'draft'>,
  ) {
    return this.prisma.pendingOperationReview.update({
      where: { id: draftId },
      data: {
        ...(data ?? {}),
        draft: draft as unknown as Prisma.InputJsonValue,
      },
    });
  }

  updateSourceMessageStatus(sourceMessageId: string, status: SourceMessageStatus) {
    return this.prisma.sourceMessage.update({
      where: { id: sourceMessageId },
      data: { status },
    });
  }

  recordParseAttempt(
    sourceMessageId: string,
    attemptType: AiParseAttemptType,
    model: string,
    prompt: Prisma.InputJsonValue,
    responsePayload: Prisma.InputJsonValue,
  ) {
    return this.prisma.aiParseAttempt.create({
      data: {
        sourceMessageId,
        attemptType,
        provider: 'polza.ai',
        model,
        prompt: JSON.stringify(prompt),
        responsePayload,
        success: true,
      },
    });
  }

  loadActiveCategories(
    householdId: string,
    type?: 'income' | 'expense' | null,
  ): Promise<ActiveCategory[]> {
    return this.prisma.category.findMany({
      where: {
        householdId,
        isActive: true,
        parentId: {
          not: null,
        },
        parent: {
          isActive: true,
        },
        ...(type
          ? {
              type: type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE,
            }
          : {}),
      },
      include: {
        parent: true,
      },
      orderBy: [{ parent: { name: 'asc' } }, { name: 'asc' }],
    } as any).then((categories: any[]) =>
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        parentId: category.parentId!,
        displayPath: `${category.parent?.name ?? 'Без родителя'} / ${category.name}`,
      })),
    );
  }
}
