import { ForbiddenException, Injectable } from '@nestjs/common';
import { LoggingService } from './logging.service';

@Injectable()
export class LogsService {
  constructor(private readonly loggingService: LoggingService) {}

  list(
    actor: { role?: string },
    filters: { level?: string; source?: string; limit?: number },
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }

    return this.loggingService.readLogs(filters);
  }
}
