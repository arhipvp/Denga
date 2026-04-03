import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RuntimeValidationService } from '../common/runtime-validation.service';
import { TelegramDeliveryService } from '../telegram/telegram-delivery.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeValidationService: RuntimeValidationService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
  ) {}

  getLiveness() {
    return {
      status: 'ok',
      telegram: this.telegramDeliveryService.getStatus(),
    };
  }

  async getReadiness() {
    const snapshot = this.runtimeValidationService.getReadinessSnapshot();

    let databaseReady = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      databaseReady = false;
    }

    const warnings = [...snapshot.validation.warnings];
    const errors = [...snapshot.validation.errors];

    if (!databaseReady) {
      errors.push('Database connection failed.');
    }

    if (!snapshot.config.aiConfigured) {
      warnings.push('AI provider is not configured; receipt parsing works in fallback mode only.');
    }

    return {
      status: errors.length === 0 ? 'ok' : 'degraded',
      checks: {
        databaseReady,
        storageReady: snapshot.storage.uploadsReady && snapshot.storage.backupsReady && snapshot.storage.logsReady,
        telegramConfigured: snapshot.config.telegramConfigured,
        telegramMode: snapshot.config.telegramMode,
        aiConfigured: snapshot.config.aiConfigured,
      },
      errors,
      warnings,
    };
  }
}
