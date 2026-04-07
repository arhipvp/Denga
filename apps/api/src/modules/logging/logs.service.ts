import { ForbiddenException, Injectable } from '@nestjs/common';
import { LoggingService } from './logging.service';
import type { ReadLogsFilters } from './logging.types';

@Injectable()
export class LogsService {
  constructor(private readonly loggingService: LoggingService) {}

  list(
    actor: { role?: string },
    filters: ReadLogsFilters,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    return this.loggingService.readLogs(filters);
  }
}
