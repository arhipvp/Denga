import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { LoggingModule } from '../logging/logging.module';
import { TelegramDeliveryModule } from '../telegram/telegram-delivery.module';
import { BackupTelegramDeliveryService } from './backup-telegram-delivery.service';
import { BackupSchedulerService } from './backup-scheduler.service';

@Module({
  imports: [LoggingModule, TelegramDeliveryModule, ScheduleModule.forRoot()],
  controllers: [BackupController],
  providers: [BackupService, BackupTelegramDeliveryService, BackupSchedulerService],
  exports: [BackupService, BackupTelegramDeliveryService],
})
export class BackupModule {}
