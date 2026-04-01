import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { getApiRuntimeConfig } from '../../common/runtime-config';
import { LoggingService } from '../../logging/logging.service';
import { TelegramService } from '../telegram.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly pollingRetryDelayMs = 30000;
  private bot?: Telegraf;
  private pollingLaunchPromise?: Promise<void>;
  private pollingRetryTimer?: NodeJS.Timeout;

  constructor(
    private readonly telegramService: TelegramService,
    private readonly loggingService: LoggingService,
  ) {}

  async onModuleInit() {
    const runtimeConfig = getApiRuntimeConfig();
    const token = runtimeConfig.telegramBotToken;
    const mode = runtimeConfig.telegramMode;

    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not configured');
      this.loggingService.warn('telegram', 'bot_token_missing', 'Telegram bot token is not configured');
      return;
    }

    this.bot = new Telegraf(token);
    this.bot.on('message', async (ctx) => {
      await this.telegramService.handleUpdate(
        ctx.update as unknown as Record<string, unknown>,
      );
    });
    this.bot.on('callback_query', async (ctx) => {
      await this.telegramService.handleUpdate(
        ctx.update as unknown as Record<string, unknown>,
      );
    });

    if (mode === 'polling') {
      this.launchPollingWithRetry();
    }
  }

  private launchPollingWithRetry() {
    if (!this.bot || this.pollingLaunchPromise) {
      return;
    }

    this.pollingLaunchPromise = this.bot
      .launch()
      .then(() => {
        this.logger.log('Telegram bot launched in polling mode');
        this.loggingService.info(
          'telegram',
          'polling_started',
          'Telegram bot launched in polling mode',
        );
      })
      .catch((error) => {
        this.logger.error('Telegram polling launch failed', error);
        this.loggingService.error(
          'telegram',
          'polling_failed',
          'Telegram polling launch failed',
          {
            exception: error,
            retryDelayMs: this.pollingRetryDelayMs,
          },
        );

        this.schedulePollingRetry();
      })
      .finally(() => {
        this.pollingLaunchPromise = undefined;
      });
  }

  private schedulePollingRetry() {
    if (this.pollingRetryTimer) {
      return;
    }

    this.pollingRetryTimer = setTimeout(() => {
      this.pollingRetryTimer = undefined;
      this.launchPollingWithRetry();
    }, this.pollingRetryDelayMs);
  }
}
