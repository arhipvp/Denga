import { Injectable } from '@nestjs/common';
import {
  SourceMessageStatus,
  SourceMessageType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TransactionNotificationService } from '../telegram/transaction-notification.service';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionCoreService } from './transaction-core.service';

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactionCoreService: TransactionCoreService,
    private readonly householdContext: HouseholdContextService,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {}

  list(status?: string, type?: string) {
    return this.prisma.transaction.findMany({
      where: {
        householdId: this.householdContext.getHouseholdId(),
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
    const householdId = this.householdContext.getHouseholdId();
    const now = new Date();
    const currentPeriodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextPeriodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const previousPeriodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const monthKeys = Array.from({ length: 6 }, (_, index) => {
      const value = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1),
      );

      return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
    });

    const recent = await this.prisma.transaction.findMany({
      where: {
        householdId,
      },
      orderBy: {
        occurredAt: 'desc',
      },
      take: 8,
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
    });

    const allTransactions = await this.prisma.transaction.findMany({
      where: {
        householdId,
      },
      include: {
        category: true,
      },
      orderBy: {
        occurredAt: 'asc',
      },
    });

    const monthlyMap = new Map<string, { month: string; income: number; expense: number; net: number }>(
      monthKeys.map((month) => [month, { month, income: 0, expense: 0, net: 0 }]),
    );
    const currentCategoryExpenseMap = new Map<string, { categoryId: string | null; categoryName: string; amount: number }>();
    const currentCategoryIncomeMap = new Map<string, { categoryId: string | null; categoryName: string; amount: number }>();
    const currentPeriodTotals = { income: 0, expense: 0, balance: 0 };
    const previousPeriodTotals = { income: 0, expense: 0, balance: 0 };
    const counts = { operations: 0, income: 0, expense: 0, cancelled: 0 };
    const averageAccumulator = { incomeTotal: 0, incomeCount: 0, expenseTotal: 0, expenseCount: 0, total: 0, totalCount: 0 };

    for (const item of allTransactions) {
      const amount = Number(item.amount);
      const month = `${item.occurredAt.getUTCFullYear()}-${String(
        item.occurredAt.getUTCMonth() + 1,
      ).padStart(2, '0')}`;

      if (item.status === TransactionStatus.CONFIRMED) {
        const monthlyEntry = monthlyMap.get(month);
        if (monthlyEntry) {
          if (item.type === TransactionType.INCOME) {
            monthlyEntry.income += amount;
            monthlyEntry.net += amount;
          } else {
            monthlyEntry.expense += amount;
            monthlyEntry.net -= amount;
          }
        }
      }

      const isCurrentPeriod =
        item.occurredAt >= currentPeriodStart && item.occurredAt < nextPeriodStart;
      const isPreviousPeriod =
        item.occurredAt >= previousPeriodStart && item.occurredAt < currentPeriodStart;

      if (item.status === TransactionStatus.CANCELLED && isCurrentPeriod) {
        counts.cancelled += 1;
      }

      if (item.status !== TransactionStatus.CONFIRMED) {
        continue;
      }

      if (isCurrentPeriod) {
        counts.operations += 1;
        averageAccumulator.total += amount;
        averageAccumulator.totalCount += 1;

        if (item.type === TransactionType.INCOME) {
          counts.income += 1;
          currentPeriodTotals.income += amount;
          currentPeriodTotals.balance += amount;
          averageAccumulator.incomeTotal += amount;
          averageAccumulator.incomeCount += 1;

          const key = item.categoryId ?? 'uncategorized-income';
          const current =
            currentCategoryIncomeMap.get(key) ?? {
              categoryId: item.categoryId ?? null,
              categoryName: item.category?.name ?? 'Без категории',
              amount: 0,
            };
          current.amount += amount;
          currentCategoryIncomeMap.set(key, current);
        } else {
          counts.expense += 1;
          currentPeriodTotals.expense += amount;
          currentPeriodTotals.balance -= amount;
          averageAccumulator.expenseTotal += amount;
          averageAccumulator.expenseCount += 1;

          const key = item.categoryId ?? 'uncategorized-expense';
          const current =
            currentCategoryExpenseMap.get(key) ?? {
              categoryId: item.categoryId ?? null,
              categoryName: item.category?.name ?? 'Без категории',
              amount: 0,
            };
          current.amount += amount;
          currentCategoryExpenseMap.set(key, current);
        }
      }

      if (isPreviousPeriod) {
        if (item.type === TransactionType.INCOME) {
          previousPeriodTotals.income += amount;
          previousPeriodTotals.balance += amount;
        } else {
          previousPeriodTotals.expense += amount;
          previousPeriodTotals.balance -= amount;
        }
      }
    }

    const topExpenseCategories = Array.from(currentCategoryExpenseMap.values())
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        share:
          currentPeriodTotals.expense > 0 ? item.amount / currentPeriodTotals.expense : 0,
      }));

    const topIncomeCategories = Array.from(currentCategoryIncomeMap.values())
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        share:
          currentPeriodTotals.income > 0 ? item.amount / currentPeriodTotals.income : 0,
      }));

    return {
      totals: {
        currentPeriod: currentPeriodTotals,
        previousPeriod: previousPeriodTotals,
      },
      diffs: {
        income: currentPeriodTotals.income - previousPeriodTotals.income,
        expense: currentPeriodTotals.expense - previousPeriodTotals.expense,
        balance: currentPeriodTotals.balance - previousPeriodTotals.balance,
      },
      counts,
      average: {
        income:
          averageAccumulator.incomeCount > 0
            ? averageAccumulator.incomeTotal / averageAccumulator.incomeCount
            : 0,
        expense:
          averageAccumulator.expenseCount > 0
            ? averageAccumulator.expenseTotal / averageAccumulator.expenseCount
            : 0,
        transaction:
          averageAccumulator.totalCount > 0
            ? averageAccumulator.total / averageAccumulator.totalCount
            : 0,
      },
      topExpenseCategories,
      topIncomeCategories,
      monthly: Array.from(monthlyMap.values()),
      recent,
    };
  }

  async createManual(dto: CreateTransactionDto, authorId?: string) {
    const settings = await this.settingsService.getSettings();
    await this.transactionCoreService.ensureCategoryType(dto.categoryId, dto.type);
    const sourceMessage = await this.prisma.sourceMessage.create({
      data: {
        householdId: this.householdContext.getHouseholdId(),
        authorId,
        type: SourceMessageType.ADMIN_MANUAL,
        status: SourceMessageStatus.PARSED,
        rawPayload: {},
      },
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        householdId: this.householdContext.getHouseholdId(),
        authorId,
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
        author: true,
        sourceMessage: true,
      },
    });

    await this.transactionNotificationService.notifyTransactionCreated(transaction.id);

    return transaction;
  }

  async update(id: string, dto: UpdateTransactionDto) {
    const current = await this.prisma.transaction.findUniqueOrThrow({
      where: { id },
    });
    const finalType =
      dto.type ?? (current.type === TransactionType.INCOME ? 'income' : 'expense');
    const finalCategoryId = dto.categoryId ?? current.categoryId;
    if (finalCategoryId) {
      await this.transactionCoreService.ensureCategoryType(finalCategoryId, finalType);
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
