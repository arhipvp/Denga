import { TransactionStatus, TransactionType } from '@prisma/client';

export type CurrentMonthCategoryBreakdownItem = {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  share: number;
  isOther?: boolean;
};

export type CurrentMonthCategoryBreakdown = {
  periodLabel: string;
  currency: string;
  totalAmount: number;
  items: CurrentMonthCategoryBreakdownItem[];
  fullItems: CurrentMonthCategoryBreakdownItem[];
};

export type SummaryCategoryItem = {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  share: number;
};

export type SummaryMonthlyItem = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

export type TransactionSummary = {
  totals: {
    currentPeriod: {
      income: number;
      expense: number;
      balance: number;
    };
    previousPeriod: {
      income: number;
      expense: number;
      balance: number;
    };
  };
  diffs: {
    income: number;
    expense: number;
    balance: number;
  };
  counts: {
    operations: number;
    income: number;
    expense: number;
    cancelled: number;
  };
  average: {
    income: number;
    expense: number;
    transaction: number;
  };
  topExpenseCategories: SummaryCategoryItem[];
  topIncomeCategories: SummaryCategoryItem[];
  monthly: SummaryMonthlyItem[];
};

export type SummaryCalculationTransaction = {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  occurredAt: Date;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryId: string | null;
  parentCategoryName: string | null;
};

export type SortDirection = 'asc' | 'desc';

export type TransactionSortField =
  | 'occurredAt'
  | 'amount'
  | 'type'
  | 'status'
  | 'category'
  | 'author'
  | 'createdAt';

export type TransactionListFilters = {
  status?: string;
  type?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  page?: number;
  pageSize?: number;
};

export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
