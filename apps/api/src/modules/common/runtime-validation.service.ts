import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ApiRuntimeConfig, getApiRuntimeConfig } from './runtime-config';

type RuntimeValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

@Injectable()
export class RuntimeValidationService {
  private readonly runtimeConfig = getApiRuntimeConfig();

  validateRuntime(env: NodeJS.ProcessEnv = process.env): RuntimeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = getApiRuntimeConfig(env);

    if (!config.jwtSecret || config.jwtSecret === 'change-me') {
      warnings.push('JWT_SECRET uses a default placeholder value.');
    }

    if (config.telegramMode === 'webhook' && !config.telegramWebhookUrl) {
      errors.push('TELEGRAM_WEBHOOK_URL is required when TELEGRAM_MODE=webhook.');
    }

    if (config.telegramMode === 'polling' && !config.telegramBotToken) {
      warnings.push('TELEGRAM_BOT_TOKEN is missing; Telegram polling will stay disabled.');
    }

    if (!env.DATABASE_URL) {
      errors.push('DATABASE_URL is required.');
    }

    if (!config.polzaApiKey) {
      warnings.push('POLZA_API_KEY is missing; AI parsing will operate in degraded fallback mode.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  ensureOperationalDirectories(config: ApiRuntimeConfig = this.runtimeConfig) {
    const basePath = process.cwd();

    for (const directory of [config.uploadDir, config.backupDir, config.logDir]) {
      mkdirSync(join(basePath, directory), { recursive: true });
    }
  }

  getReadinessSnapshot(env: NodeJS.ProcessEnv = process.env) {
    const validation = this.validateRuntime(env);
    const config = getApiRuntimeConfig(env);

    return {
      config: {
        telegramMode: config.telegramMode,
        telegramConfigured: Boolean(config.telegramBotToken),
        telegramWebhookConfigured: Boolean(config.telegramWebhookUrl),
        aiConfigured: Boolean(config.polzaApiKey),
      },
      storage: {
        uploadsReady: existsSync(join(process.cwd(), config.uploadDir)),
        backupsReady: existsSync(join(process.cwd(), config.backupDir)),
        logsReady: existsSync(join(process.cwd(), config.logDir)),
      },
      validation,
    };
  }
}
