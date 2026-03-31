import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { TelegramService } from '../telegram.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot?: Telegraf;

  constructor(private readonly telegramService: TelegramService) {}

  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const mode = process.env.TELEGRAM_MODE ?? 'polling';

    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not configured');
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
      void this.bot
        .launch()
        .then(() => {
          this.logger.log('Telegram bot launched in polling mode');
        })
        .catch((error) => {
          this.logger.error('Telegram polling launch failed', error);
        });
    }
  }
}
