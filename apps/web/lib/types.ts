export type AuthState = {
  accessToken: string;
  user: {
    email: string;
    role: string;
  };
};

export type Category = {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  isActive: boolean;
};

export type Transaction = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  occurredAt: string;
  comment: string | null;
  status: 'CONFIRMED' | 'NEEDS_CLARIFICATION' | 'CANCELLED';
  category: Category | null;
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
    income: number;
    expense: number;
    balance: number;
    reviewCount: number;
    cancelledCount: number;
  };
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
};

export const emptyPasswordForm: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};
