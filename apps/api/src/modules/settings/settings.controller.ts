import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LoggingService } from '../logging/logging.service';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put()
  async update(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Body() dto: UpdateSettingsDto,
  ) {
    const settings = await this.settingsService.update(dto);
    this.loggingService.info('admin', 'settings_updated', 'Settings updated', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      telegramMode: dto.telegramMode,
      aiModel: dto.aiModel,
    });
    return settings;
  }
}
