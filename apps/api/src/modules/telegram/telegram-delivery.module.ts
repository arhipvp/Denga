import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TransactionNotificationService } from './transaction-notification.service';

@Module({
  imports: [LoggingModule],
  providers: [TelegramDeliveryService, TransactionNotificationService],
  exports: [TelegramDeliveryService, TransactionNotificationService],
})
export class TelegramDeliveryModule {}
