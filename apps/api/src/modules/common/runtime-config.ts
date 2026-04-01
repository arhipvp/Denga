export type TelegramMode = 'polling' | 'webhook';

export type ApiRuntimeConfig = {
  port: number;
  nodeEnv: string;
  uploadDir: string;
  backupDir: string;
  backupKeepCount: number;
  jwtSecret: string;
  logDir: string;
  logLevel?: string;
  polzaApiKey?: string;
  polzaBaseUrl: string;
  polzaModel: string;
  telegramBotToken?: string;
  telegramMode: TelegramMode;
  telegramWebhookUrl: string | null;
};

export function getApiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiRuntimeConfig {
  const telegramMode =
    env.TELEGRAM_MODE === 'webhook' ? 'webhook' : 'polling';
  const backupKeepCount = Number(env.BACKUP_KEEP_COUNT ?? 10);

  return {
    port: Number(env.PORT ?? 3001),
    nodeEnv: env.NODE_ENV ?? 'development',
    uploadDir: env.UPLOAD_DIR ?? 'uploads',
    backupDir: env.BACKUP_DIR ?? 'backups',
    backupKeepCount:
      Number.isFinite(backupKeepCount) && backupKeepCount > 0 ? backupKeepCount : 10,
    jwtSecret: env.JWT_SECRET ?? 'change-me',
    logDir: env.LOG_DIR ?? 'logs',
    logLevel: env.LOG_LEVEL,
    polzaApiKey: env.POLZA_API_KEY,
    polzaBaseUrl: env.POLZA_BASE_URL ?? 'https://polza.ai/api/v1',
    polzaModel: env.POLZA_MODEL ?? 'google/gemini-2.5-flash',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramMode,
    telegramWebhookUrl: env.TELEGRAM_WEBHOOK_URL || null,
  };
}
