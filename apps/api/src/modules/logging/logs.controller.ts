import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LogsService } from './logs.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  list(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Query('level') level?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.logsService.list(request.user, {
      level,
      source,
      search,
      sortBy,
      sortDir,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
