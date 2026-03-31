import { Injectable } from '@nestjs/common';
import {
  CategoryType,
  SourceMessageStatus,
  SourceMessageType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  list(status?: string, type?: string) {
    return this.prisma.transaction.findMany({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        ...(status ? { status: this.mapStatus(status) } : {}),
        ...(type ? { type: this.mapType(type) } : {}),
      },
      include: {
        category: true,
        author: true,
        sourceMessage: {
          include: {
            attachments: true,
            clarificationSession: true,
            reviewDraft: true,
            parseAttempts: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
      orderBy: {
        occurredAt: 'desc',
      },
    });
  }

  async summary() {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        status: TransactionStatus.CONFIRMED,
      },
      orderBy: {
        occurredAt: 'desc',
      },
      take: 8,
      include: {
        category: true,
      },
    });

    const totals = transactions.reduce(
      (acc, item) => {
        const amount = Number(item.amount);
        if (item.type === TransactionType.INCOME) {
          acc.income += amount;
        } else {
          acc.expense += amount;
        }
        return acc;
      },
      { income: 0, expense: 0 },
    );

    const allConfirmed = await this.prisma.transaction.findMany({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        status: TransactionStatus.CONFIRMED,
      },
      select: {
        amount: true,
        type: true,
        occurredAt: true,
      },
      orderBy: {
        occurredAt: 'asc',
      },
    });

    const monthlyMap = new Map<
      string,
      { month: string; income: number; expense: number; net: number }
    >();

    for (const item of allConfirmed) {
      const month = `${item.occurredAt.getUTCFullYear()}-${String(
        item.occurredAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      const current = monthlyMap.get(month) ?? {
        month,
        income: 0,
        expense: 0,
        net: 0,
      };
      const amount = Number(item.amount);
      if (item.type === TransactionType.INCOME) {
        current.income += amount;
        current.net += amount;
      } else {
        current.expense += amount;
        current.net -= amount;
      }
      monthlyMap.set(month, current);
    }

    const reviewCount = await this.prisma.transaction.count({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        status: TransactionStatus.NEEDS_CLARIFICATION,
      },
    });

    const cancelledCount = await this.prisma.transaction.count({
      where: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        status: TransactionStatus.CANCELLED,
      },
    });

    return {
      totals: {
        income: totals.income,
        expense: totals.expense,
        balance: totals.income - totals.expense,
        reviewCount,
        cancelledCount,
      },
      monthly: Array.from(monthlyMap.values()).slice(-6),
      recent: transactions,
    };
  }

  async createManual(dto: CreateTransactionDto) {
    const settings = await this.settingsService.getSettings();
    await this.ensureCategoryType(dto.categoryId, dto.type);
    const sourceMessage = await this.prisma.sourceMessage.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        type: SourceMessageType.ADMIN_MANUAL,
        status: SourceMessageStatus.PARSED,
        rawPayload: {},
      },
    });

    return this.prisma.transaction.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        sourceMessageId: sourceMessage.id,
        type: dto.type === 'income' ? TransactionType.INCOME : TransactionType.EXPENSE,
        amount: new Decimal(dto.amount),
        currency: settings.defaultCurrency,
        occurredAt: new Date(dto.occurredAt),
        comment: dto.comment,
        categoryId: dto.categoryId,
        status: TransactionStatus.CONFIRMED,
      },
      include: {
        category: true,
        sourceMessage: true,
      },
    });
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const current = await this.prisma.transaction.findUniqueOrThrow({
      where: { id },
    });
    const finalType =
      dto.type ?? (current.type === TransactionType.INCOME ? 'income' : 'expense');
    const finalCategoryId = dto.categoryId ?? current.categoryId;
    if (finalCategoryId) {
      await this.ensureCategoryType(finalCategoryId, finalType);
    }

    return this.prisma.transaction.update({
      where: { id },
      data: {
        ...(dto.type
          ? {
              type:
                dto.type === 'income'
                  ? TransactionType.INCOME
                  : TransactionType.EXPENSE,
            }
          : {}),
        ...(dto.amount ? { amount: new Decimal(dto.amount) } : {}),
        ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
        ...(dto.status ? { status: this.mapStatus(dto.status) } : {}),
      },
      include: {
        category: true,
        sourceMessage: {
          include: {
            attachments: true,
            clarificationSession: true,
            reviewDraft: true,
            parseAttempts: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
    });
  }

  async cancel(id: string) {
    await this.prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.CANCELLED,
      },
    });
    return { success: true };
  }

  private async ensureCategoryType(
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
  }

  private mapStatus(status: string) {
    switch (status) {
      case 'confirmed':
        return TransactionStatus.CONFIRMED;
      case 'needs_clarification':
        return TransactionStatus.NEEDS_CLARIFICATION;
      case 'cancelled':
        return TransactionStatus.CANCELLED;
      default:
        return undefined;
    }
  }

  private mapType(type: string) {
    switch (type) {
      case 'income':
        return TransactionType.INCOME;
      case 'expense':
        return TransactionType.EXPENSE;
      default:
        return undefined;
    }
  }
}
