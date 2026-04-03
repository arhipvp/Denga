import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { TelegramDeliveryService } from '../telegram/telegram-delivery.service';
import { BackupService } from './backup.service';

@Injectable()
export class BackupTelegramDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backupService: BackupService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
    private readonly loggingService: LoggingService,
  ) {}

  async sendScheduledBackup() {
    const recipient = await this.findRecipient();

    if (!recipient) {
      this.loggingService.warn(
        'backup',
        'scheduled_backup_skipped',
        'Scheduled Telegram backup skipped: no admin Telegram recipient found',
      );
      return {
        status: 'skipped' as const,
      };
    }

    try {
      this.loggingService.info(
        'backup',
        'scheduled_backup_started',
        'Scheduled Telegram backup started',
        {
          recipientUserId: recipient.userId,
          recipientTelegramId: recipient.telegramId,
        },
      );

      const artifact = await this.backupService.createBackupArtifact({
        sub: 'system:scheduled-backup',
        email: 'system@local',
        role: 'ADMIN',
      });

      await this.telegramDeliveryService.sendTelegramDocument({
        chatId: recipient.telegramId,
        filePath: artifact.filePath,
        fileName: artifact.info.fileName,
        caption: this.buildCaption(artifact.info),
      });

      this.loggingService.info(
        'backup',
        'scheduled_backup_sent',
        'Scheduled Telegram backup sent',
        {
          recipientUserId: recipient.userId,
          recipientTelegramId: recipient.telegramId,
          fileName: artifact.info.fileName,
          sizeBytes: artifact.info.sizeBytes,
        },
      );

      return {
        status: 'sent' as const,
        recipientTelegramId: recipient.telegramId,
        fileName: artifact.info.fileName,
      };
    } catch (error) {
      this.loggingService.error(
        'backup',
        'scheduled_backup_failed',
        'Scheduled Telegram backup failed',
        {
          recipientUserId: recipient.userId,
          recipientTelegramId: recipient.telegramId,
          error,
        },
      );
      return {
        status: 'failed' as const,
      };
    }
  }

  async findRecipient() {
    const admin = await this.prisma.user.findFirst({
      where: {
        role: UserRole.ADMIN,
        telegramAccounts: {
          some: {
            isActive: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        telegramAccounts: {
          where: {
            isActive: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 1,
          select: {
            telegramId: true,
          },
        },
      },
    });

    const telegramId = admin?.telegramAccounts[0]?.telegramId;
    if (!admin || !telegramId) {
      return null;
    }

    return {
      userId: admin.id,
      telegramId,
    };
  }

  private buildCaption(info: { fileName: string; sizeBytes: number; createdAt: string }) {
    return [
      'Автоматический backup Denga',
      `Файл: ${info.fileName}`,
      `Размер: ${info.sizeBytes} bytes`,
      `Создан: ${info.createdAt}`,
      'Сохраните файл вручную в надежное место.',
    ].join('\n');
  }
}
