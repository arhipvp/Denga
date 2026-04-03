import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import axios, { AxiosRequestConfig } from 'axios';
import { getApiRuntimeConfig } from '../common/runtime-config';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class TelegramDeliveryService {
  private readonly logger = new Logger(TelegramDeliveryService.name);
  private readonly telegramRequestRetries = 3;
  private readonly telegramRequestBaseDelayMs = 1000;

  constructor(private readonly loggingService: LoggingService) {}

  getStatus() {
    const runtimeConfig = getApiRuntimeConfig();
    return {
      mode: runtimeConfig.telegramMode,
      botConfigured: Boolean(runtimeConfig.telegramBotToken),
      webhookUrl: runtimeConfig.telegramWebhookUrl,
    };
  }

  async sendTelegramMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) {
      return { message_id: 0 };
    }

    const response = await this.requestTelegramApi<{ result: { message_id: number } }>(
      {
        method: 'POST',
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        data: {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        },
      },
      'telegram_send_message',
      'Telegram sendMessage failed',
      { chatId },
    );

    return response.data.result as { message_id: number };
  }

  async sendTelegramDocument(input: {
    chatId: string;
    filePath: string;
    fileName: string;
    caption?: string;
  }) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) {
      return { message_id: 0 };
    }

    const formData = new FormData();
    const buffer = await readFile(input.filePath);
    const documentBlob = new Blob([buffer], {
      type: 'application/octet-stream',
    });

    formData.append('chat_id', input.chatId);
    formData.append('document', documentBlob, input.fileName);
    if (input.caption) {
      formData.append('caption', input.caption);
    }

    const response = await this.requestTelegramApi<{ result: { message_id: number } }>(
      {
        method: 'POST',
        url: `https://api.telegram.org/bot${token}/sendDocument`,
        data: formData,
      },
      'telegram_send_document',
      'Telegram sendDocument failed',
      {
        chatId: input.chatId,
        fileName: input.fileName,
      },
    );

    return response.data.result as { message_id: number };
  }

  async editTelegramMessage(
    chatId: string,
    messageId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) return false;

    try {
      await this.requestTelegramApi(
        {
          method: 'POST',
          url: `https://api.telegram.org/bot${token}/editMessageText`,
          data: {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          },
        },
        'telegram_edit_message',
        'Telegram editMessageText failed',
        { chatId, messageId },
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const description = error.response?.data?.description;
        if (
          typeof description === 'string' &&
          description.includes('message is not modified')
        ) {
          this.logger.debug(`telegram_message_not_modified chat=${chatId} message=${messageId}`);
          return true;
        }
        this.logger.error(
          `telegram_edit_message_failed chat=${chatId} message=${messageId} code=${error.code ?? 'unknown'} description=${description ?? 'n/a'}`,
        );
        return false;
      }
      this.logger.error('telegram_edit_message_failed', error);
      return false;
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) return;

    try {
      await this.requestTelegramApi(
        {
          method: 'POST',
          url: `https://api.telegram.org/bot${token}/answerCallbackQuery`,
          data: {
            callback_query_id: callbackQueryId,
            ...(text ? { text } : {}),
          },
        },
        'telegram_answer_callback',
        'Telegram answerCallbackQuery failed',
        { callbackQueryId },
      );
    } catch (error) {
      this.logger.error('telegram_answer_callback_failed', error);
    }
  }

  async requestTelegramApi<T>(
    config: AxiosRequestConfig,
    event: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= this.telegramRequestRetries;
      attempt += 1
    ) {
      try {
        return await axios.request<T>(config);
      } catch (error) {
        lastError = error;

        if (
          !this.isRetriableTelegramNetworkError(error) ||
          attempt === this.telegramRequestRetries
        ) {
          throw error;
        }

        const delayMs = this.telegramRequestBaseDelayMs * attempt;
        this.loggingService.warn(
          'telegram',
          `${event}_retry_scheduled`,
          `${message}; retry scheduled`,
          {
            ...context,
            attempt,
            delayMs,
            errorCode: axios.isAxiosError(error) ? error.code : undefined,
          },
        );
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  private isRetriableTelegramNetworkError(error: unknown) {
    if (!axios.isAxiosError(error) || error.response) {
      return false;
    }

    return ['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes(
      error.code ?? '',
    );
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
