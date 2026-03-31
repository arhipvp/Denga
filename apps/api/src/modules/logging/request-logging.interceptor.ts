import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { LoggingService } from './logging.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      user?: { sub?: string; email?: string; role?: string };
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
      ip?: string;
    }>();
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.loggingService.info('http', 'request_completed', 'HTTP request completed', {
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
            ip: request.ip,
            userId: request.user?.sub,
            userEmail: request.user?.email,
            userRole: request.user?.role,
            query: request.query,
            params: request.params,
          });
        },
      }),
    );
  }
}
