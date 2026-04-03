import { Injectable } from '@nestjs/common';
import { UpdateRouterService } from './update-router.service';
import { TelegramDeliveryService } from './telegram-delivery.service';

@Injectable()
export class TelegramService {
  constructor(
    private readonly updateRouterService: UpdateRouterService,
    private readonly telegramDeliveryService: TelegramDeliveryService,
  ) {}

  getStatus() {
    return this.telegramDeliveryService.getStatus();
  }

  handleUpdate(update: Record<string, unknown>) {
    return this.updateRouterService.handleUpdate(update);
  }
}
