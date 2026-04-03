import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoggingService } from '../logging/logging.service';
import { BackupTelegramDeliveryService } from './backup-telegram-delivery.service';

@Injectable()
export class BackupSchedulerService {
  constructor(
    private readonly backupTelegramDeliveryService: BackupTelegramDeliveryService,
    private readonly loggingService: LoggingService,
  ) {}

  @Cron('0 0 12 */3 * *', {
    timeZone: 'Europe/Moscow',
  })
  async handleScheduledBackup() {
    this.loggingService.info(
      'backup',
      'scheduled_backup_tick',
      'Scheduled backup tick started',
      {
        schedule: '0 0 12 */3 * *',
        timeZone: 'Europe/Moscow',
      },
    );

    await this.backupTelegramDeliveryService.sendScheduledBackup();
  }
}
