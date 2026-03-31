import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LogsService } from './logs.service';

@UseGuards(JwtAuthGuard)
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  list(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Query('level') level?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logsService.list(request.user, {
      level,
      source,
      limit: limit ? Number(limit) : 100,
    });
  }
}
