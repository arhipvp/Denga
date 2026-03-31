import { z } from 'zod';

export const transactionTypeSchema = z.enum(['income', 'expense']);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const transactionStatusSchema = z.enum([
  'confirmed',
  'needs_clarification',
  'cancelled',
]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const transactionSourceTypeSchema = z.enum([
  'telegram_text',
  'telegram_receipt',
  'admin_manual',
]);
export type TransactionSourceType = z.infer<typeof transactionSourceTypeSchema>;

export const aiStructuredParseSchema = z.object({
  type: transactionTypeSchema.nullable(),
  amount: z.number().positive().nullable(),
  occurredAt: z.string().datetime().nullable(),
  categoryCandidate: z.string().min(1).nullable(),
  comment: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
});

export type AiStructuredParse = z.infer<typeof aiStructuredParseSchema>;

export const loginDtoSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof loginDtoSchema>;

export const transactionUpsertSchema = z.object({
  type: transactionTypeSchema,
  amount: z.number().positive(),
  occurredAt: z.string().datetime(),
  categoryId: z.string().min(1),
  comment: z.string().optional().nullable(),
  status: transactionStatusSchema.default('confirmed'),
});

export type TransactionUpsertDto = z.infer<typeof transactionUpsertSchema>;

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});

export type CategoryDto = z.infer<typeof categorySchema>;

export const settingsSchema = z.object({
  householdName: z.string(),
  defaultCurrency: z.string(),
  telegramMode: z.enum(['polling', 'webhook']),
  clarificationTimeoutMinutes: z.number().int().positive(),
  parsingPrompt: z.string(),
});

export type SettingsDto = z.infer<typeof settingsSchema>;
