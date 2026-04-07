import { CategoryType } from '@prisma/client';

export type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
  from?: {
    id: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  photo?: Array<{ file_id: string }>;
  document?: {
    file_id: string;
    mime_type?: string;
    file_name?: string;
  };
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from: {
    id: number | string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  message?: {
    message_id: number;
    chat: { id: number | string };
  };
};

export type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type ReviewDraft = {
  type: 'income' | 'expense' | null;
  amount: number | null;
  occurredAt: string | null;
  categoryId: string | null;
  categoryName: string | null;
  comment: string | null;
  currency: string | null;
  confidence: number;
  ambiguities: string[];
  followUpQuestion: string | null;
  sourceText: string | null;
};

export type ConversationEntry = {
  role: 'assistant' | 'user';
  text: string;
  at: string;
};

export type ActiveCategory = {
  id: string;
  name: string;
  type: CategoryType;
  parentId: string;
  displayPath: string;
};
