import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus() {
    return this.telegramService.getStatus();
  }

  @Post('webhook')
  webhook(@Body() update: Record<string, unknown>) {
    return this.telegramService.handleUpdate(update);
  }
}
