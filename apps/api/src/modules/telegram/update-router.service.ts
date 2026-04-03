import { Injectable, Logger } from '@nestjs/common';
import { LoggingService } from '../logging/logging.service';
import { ClarificationService } from './clarification.service';
import { MessageIngestionService } from './message-ingestion.service';
import { TelegramUpdate } from './telegram.types';

@Injectable()
export class UpdateRouterService {
  private readonly logger = new Logger(UpdateRouterService.name);

  constructor(
    private readonly messageIngestionService: MessageIngestionService,
    private readonly clarificationService: ClarificationService,
    private readonly loggingService: LoggingService,
  ) {}

  async handleUpdate(update: Record<string, unknown>) {
    const payload = update as TelegramUpdate;

    try {
      if (payload.callback_query) {
        return await this.clarificationService.handleCallbackQuery(payload.callback_query);
      }

      if (!payload.message) {
        return { accepted: true, ignored: true };
      }

      return await this.messageIngestionService.handleMessage(payload.message, update);
    } catch (error) {
      this.logger.error('telegram_update_failed', error);
      this.loggingService.error('telegram', 'update_failed', 'Telegram update processing failed', {
        exception: error,
      });
      return { accepted: true, error: true };
    }
  }
}
