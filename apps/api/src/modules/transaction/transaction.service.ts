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
  calculateCurrentMonthCategoryBreakdown,
  calculateTransactionSummary,
} from './transaction-summary';
import { TransactionCoreService } from './transaction-core.service';
import type {
  CurrentMonthCategoryBreakdown,
  PagedResult,
  SortDirection,
  SummaryCalculationTransaction,
  TransactionListFilters,
  TransactionSortField,
  TransactionSummary,
} from './transaction.types';

@Injectable()
export class TransactionService {
  private static readonly defaultPageSize = 20;
  private static readonly maxPageSize = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly transactionCoreService: TransactionCoreService,
    private readonly householdContext: HouseholdContextService,
    private readonly transactionNotificationService: TransactionNotificationService,
  ) {}

  async list(filters: TransactionListFilters): Promise<PagedResult<unknown>> {
    const householdId = this.householdContext.getHouseholdId();
    const page = this.normalizePage(filters.page);
    const pageSize = this.normalizePageSize(filters.pageSize);
    const where = this.buildListWhere(filters, householdId);
    const orderBy = this.buildOrderBy(filters.sortBy, filters.sortDir);

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
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
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
    };
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
    return this.getCurrentMonthCategoryBreakdown(TransactionType.EXPENSE);
  }

  async getCurrentMonthIncomeBreakdown() {
    return this.getCurrentMonthCategoryBreakdown(TransactionType.INCOME);
  }

  private async getCurrentMonthCategoryBreakdown(
    type: TransactionType,
  ): Promise<CurrentMonthCategoryBreakdown> {
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
        type,
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

    return calculateCurrentMonthCategoryBreakdown({
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

  private buildListWhere(filters: TransactionListFilters, householdId: string) {
    const search = filters.search?.trim();
    const mappedStatus = filters.status ? this.mapStatus(filters.status) : undefined;
    const mappedType = filters.type ? this.mapType(filters.type) : undefined;

    return {
      householdId,
      ...(mappedStatus ? { status: mappedStatus } : {}),
      ...(mappedType ? { type: mappedType } : {}),
      ...(search
        ? {
            OR: [
              {
                comment: {
                  contains: search,
                  mode: 'insensitive' as const,
                },
              },
              {
                category: {
                  name: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                author: {
                  displayName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                sourceMessage: {
                  text: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(sortBy?: string, sortDir?: string) {
    const direction: SortDirection = sortDir === 'asc' ? 'asc' : 'desc';
    const field = this.resolveSortField(sortBy);

    switch (field) {
      case 'amount':
      case 'type':
      case 'status':
      case 'createdAt':
      case 'occurredAt':
        return [{ [field]: direction }, { occurredAt: 'desc' as const }];
      case 'category':
        return [
          {
            category: {
              name: direction,
            },
          },
          { occurredAt: 'desc' as const },
        ];
      case 'author':
        return [
          {
            author: {
              displayName: direction,
            },
          },
          { occurredAt: 'desc' as const },
        ];
      default:
        return [{ occurredAt: 'desc' as const }];
    }
  }

  private resolveSortField(value?: string): TransactionSortField {
    switch (value) {
      case 'amount':
      case 'type':
      case 'status':
      case 'category':
      case 'author':
      case 'createdAt':
        return value;
      default:
        return 'occurredAt';
    }
  }

  private normalizePage(value?: number) {
    if (!value || Number.isNaN(value) || value < 1) {
      return 1;
    }
    return Math.floor(value);
  }

  private normalizePageSize(value?: number) {
    if (!value || Number.isNaN(value) || value < 1) {
      return TransactionService.defaultPageSize;
    }

    return Math.min(Math.floor(value), TransactionService.maxPageSize);
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
