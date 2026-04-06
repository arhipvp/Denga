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
import { transactionDetailInclude } from './transaction.constants';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import {
  calculateCurrentMonthExpenseBreakdown,
  calculateTransactionSummary,
} from './transaction-summary';
import { TransactionCoreService } from './transaction-core.service';
import type {
  CurrentMonthExpenseBreakdown,
  SummaryCalculationTransaction,
  TransactionSummary,
} from './transaction.types';

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

    const recent = await this.prisma.transaction.findMany({
      where: {
        householdId,
      },
      orderBy: {
        occurredAt: 'desc',
      },
      take: 8,
      include: transactionDetailInclude,
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

    return {
      ...calculateTransactionSummary(
        allTransactions.map((item) => this.toSummaryTransaction(item)),
        now,
      ),
      recent,
    };
  }

  async getCurrentMonthExpenseBreakdown() {
    const householdId = this.householdContext.getHouseholdId();
    const settings = await this.settingsService.getSettings();
    const now = new Date();
    const currentPeriodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextPeriodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );

    const transactions = await this.prisma.transaction.findMany({
      where: {
        householdId,
        type: TransactionType.EXPENSE,
        status: TransactionStatus.CONFIRMED,
        occurredAt: {
          gte: currentPeriodStart,
          lt: nextPeriodStart,
        },
      },
      include: {
        category: true,
      },
      orderBy: {
        occurredAt: 'asc',
      },
    });

    return calculateCurrentMonthExpenseBreakdown({
      transactions: transactions.map((item) => this.toSummaryTransaction(item)),
      periodStart: currentPeriodStart,
      currency: settings.defaultCurrency,
    });
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
      include: transactionDetailInclude,
    });
  }

  async cancel(id: string) {
    const transaction = await this.prisma.transaction.update({
      where: { id },
      data: {
        status: TransactionStatus.CANCELLED,
      },
      include: {
        category: true,
        author: true,
      },
    });

    await this.transactionNotificationService.notifyTransactionDeleted(transaction.id);

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

  private toSummaryTransaction(item: {
    id: string;
    type: TransactionType;
    status: TransactionStatus;
    amount: Decimal;
    occurredAt: Date;
    categoryId: string | null;
    category?: { name: string } | null;
  }): SummaryCalculationTransaction {
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      amount: Number(item.amount),
      occurredAt: item.occurredAt,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
    };
  }
}
