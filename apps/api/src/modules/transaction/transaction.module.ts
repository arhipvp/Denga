import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { LoggingModule } from '../logging/logging.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramDeliveryModule } from '../telegram/telegram-delivery.module';
import { TransactionController } from './transaction.controller';
import { TransactionCoreService } from './transaction-core.service';
import { TransactionService } from './transaction.service';

@Module({
  imports: [CategoryModule, LoggingModule, SettingsModule, TelegramDeliveryModule],
  controllers: [TransactionController],
  providers: [TransactionService, TransactionCoreService],
  exports: [TransactionService, TransactionCoreService],
})
export class TransactionModule {}
