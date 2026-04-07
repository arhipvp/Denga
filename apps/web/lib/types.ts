export type AuthState = {
  accessToken: string;
  user: {
    email: string;
    role: string;
  };
};

export type Category = {
  id: string;
  parentId: string | null;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  isActive: boolean;
  isLeaf: boolean;
  displayPath: string;
  children: Category[];
};

export type TransactionCategory = Omit<Category, 'children'> & {
  children: Category[];
  parent?: Pick<Category, 'id' | 'name' | 'type' | 'isActive' | 'parentId'> & {
    displayPath?: string;
    isLeaf?: boolean;
    children?: Category[];
  } | null;
};

export type Transaction = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  occurredAt: string;
  comment: string | null;
  status: 'CONFIRMED' | 'NEEDS_CLARIFICATION' | 'CANCELLED';
  category: TransactionCategory | null;
  author: { displayName: string } | null;
  sourceMessage: {
    type: string;
    text: string | null;
    attachments: Array<{ id: string; localPath: string | null }>;
    parseAttempts: Array<{
      id: string;
      attemptType: 'INITIAL_PARSE' | 'CLARIFICATION_REPARSE';
      model: string;
      responsePayload: {
        categoryCandidate?: string | null;
        confidence?: number;
        ambiguities?: string[];
        followUpQuestion?: string | null;
      };
    }>;
    clarificationSession?: {
      question: string;
      status: string;
      conversation?: Array<{
        role: 'assistant' | 'user';
        text: string;
        at: string;
      }>;
    } | null;
    reviewDraft?: {
      status: string;
      pendingField: string | null;
      draft: {
        type: 'income' | 'expense' | null;
        amount: number | null;
        occurredAt: string | null;
        categoryName: string | null;
        comment: string | null;
      };
    } | null;
  } | null;
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

export type LogSortField = 'timestamp' | 'level' | 'source' | 'event';

export type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type User = {
  id: string;
  displayName: string;
  email: string | null;
  telegramAccounts: Array<{ telegramId: string; username: string | null }>;
};

export type Settings = {
  householdName: string;
  defaultCurrency: string;
  telegramMode: 'polling' | 'webhook';
  aiModel: string;
  clarificationTimeoutMinutes: number;
  parsingPrompt: string;
  clarificationPrompt: string;
};

export type BackupInfo = {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

export type Summary = {
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
  topExpenseCategories: Array<{
    categoryId: string | null;
    categoryName: string;
    amount: number;
    share: number;
  }>;
  topIncomeCategories: Array<{
    categoryId: string | null;
    categoryName: string;
    amount: number;
    share: number;
  }>;
  monthly: Array<{
    month: string;
    income: number;
    expense: number;
    net: number;
  }>;
  recent: Transaction[];
};

export type OperationFormState = {
  id?: string;
  type: 'income' | 'expense';
  amount: string;
  occurredAt: string;
  categoryId: string;
  comment: string;
  status: 'confirmed' | 'cancelled';
};

export type CategoryFormState = {
  id?: string;
  name: string;
  type: 'income' | 'expense';
  isActive: boolean;
  kind: 'parent' | 'leaf';
  parentId: string;
};

export type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type LogEntry = {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  event: string;
  message: string;
  context?: Record<string, unknown>;
};

export type TransactionListFilters = {
  status: 'all' | 'confirmed' | 'cancelled';
  type: 'all' | 'income' | 'expense';
  search: string;
  sortBy: TransactionSortField;
  sortDir: SortDirection;
  page: number;
  pageSize: number;
};

export type LogListFilters = {
  level: 'all' | LogEntry['level'];
  source: string;
  search: string;
  sortBy: LogSortField;
  sortDir: SortDirection;
  page: number;
  pageSize: number;
};

export const sections = [
  'overview',
  'operations',
  'categories',
  'users',
  'settings',
  'logs',
] as const;

export type Section = (typeof sections)[number];

export const emptyOperationForm: OperationFormState = {
  type: 'expense',
  amount: '',
  occurredAt: new Date().toISOString().slice(0, 10),
  categoryId: '',
  comment: '',
  status: 'confirmed',
};

export const emptyCategoryForm: CategoryFormState = {
  name: '',
  type: 'expense',
  isActive: true,
  kind: 'parent',
  parentId: '',
};

export const emptyPasswordForm: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};
