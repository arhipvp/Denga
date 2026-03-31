import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { LoggingModule } from '../logging/logging.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionModule } from '../transaction/transaction.module';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { AiParsingService } from './services/ai-parsing.service';
import { TelegramBotService } from './services/telegram-bot.service';

@Module({
  imports: [CategoryModule, LoggingModule, SettingsModule, TransactionModule],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramBotService, AiParsingService],
})
export class TelegramModule {}
