import { Injectable } from '@nestjs/common';
import { getApiRuntimeConfig } from '../common/runtime-config';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramMessage } from './telegram.types';

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
  ) {}

  async persistAttachments(message: TelegramMessage, sourceMessageId: string) {
    const fileId = message.document?.file_id ?? message.photo?.at(-1)?.file_id;
    if (!fileId) {
      return [];
    }

    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) {
      return [];
    }

    const fileMeta = await this.telegramDeliveryService.requestTelegramApi<{
      ok: boolean;
      result: { file_path: string };
    }>(
      {
        method: 'GET',
        url: `https://api.telegram.org/bot${token}/getFile`,
        params: { file_id: fileId },
      },
      'telegram_get_file',
      'Telegram getFile request failed',
      { sourceMessageId, fileId },
    );

    const filePath = fileMeta.data.result.file_path;

    const attachment = await this.prisma.attachment.create({
      data: {
        sourceMessageId,
        telegramFileId: fileId,
        telegramFilePath: filePath,
        mimeType: message.document?.mime_type,
        originalName: message.document?.file_name,
        localPath: null,
      },
    });

    return [attachment];
  }

  async buildAttachmentDataUrl(
    telegramFileId?: string | null,
    telegramFilePath?: string | null,
    mimeType?: string | null,
  ) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token || !telegramFileId) {
      return undefined;
    }

    const filePath = telegramFilePath ?? await this.resolveTelegramFilePath(telegramFileId);
    const fileResponse = await this.telegramDeliveryService.requestTelegramApi<ArrayBuffer>(
      {
        method: 'GET',
        url: `https://api.telegram.org/file/bot${token}/${filePath}`,
        responseType: 'arraybuffer',
      },
      'telegram_download_file',
      'Telegram file download failed',
      { telegramFileId, filePath },
    );
    const fileBuffer = Buffer.from(fileResponse.data);
    const resolvedMimeType = mimeType || this.detectMimeType(filePath);
    return `data:${resolvedMimeType};base64,${fileBuffer.toString('base64')}`;
  }

  private async resolveTelegramFilePath(fileId: string) {
    const token = getApiRuntimeConfig().telegramBotToken;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const fileMeta = await this.telegramDeliveryService.requestTelegramApi<{
      ok: boolean;
      result: { file_path: string };
    }>(
      {
        method: 'GET',
        url: `https://api.telegram.org/bot${token}/getFile`,
        params: { file_id: fileId },
      },
      'telegram_resolve_file_path',
      'Telegram file path resolution failed',
      { fileId },
    );

    return fileMeta.data.result.file_path;
  }

  private detectMimeType(filePath: string) {
    const normalized = filePath.toLowerCase();
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }
}
