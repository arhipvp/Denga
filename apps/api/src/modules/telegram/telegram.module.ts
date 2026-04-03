import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { LoggingModule } from '../logging/logging.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionModule } from '../transaction/transaction.module';
import { AttachmentService } from './attachment.service';
import { ClarificationService } from './clarification.service';
import { DraftLifecycleService } from './draft-lifecycle.service';
import { MessageIngestionService } from './message-ingestion.service';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramDraftService } from './telegram-draft.service';
import { UpdateRouterService } from './update-router.service';
import { AiParsingService } from './services/ai-parsing.service';
import { TelegramBotService } from './services/telegram-bot.service';

@Module({
  imports: [CategoryModule, LoggingModule, SettingsModule, TransactionModule],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramBotService,
    AiParsingService,
    TelegramDeliveryService,
    AttachmentService,
    TelegramDraftService,
    DraftLifecycleService,
    ClarificationService,
    MessageIngestionService,
    UpdateRouterService,
  ],
  exports: [TelegramDeliveryService],
})
export class TelegramModule {}
