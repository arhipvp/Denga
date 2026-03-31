import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { LoggingService } from './logging.service';

@Catch()
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  constructor(private readonly loggingService: LoggingService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (payload: unknown) => void };
    }>();
    const request = ctx.getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      user?: { sub?: string; email?: string; role?: string };
      ip?: string;
    }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            message: 'Internal server error',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          };

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    this.loggingService[level](
      'http',
      'request_failed',
      exception instanceof Error ? exception.message : 'Unhandled exception',
      {
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode: status,
        ip: request.ip,
        userId: request.user?.sub,
        userEmail: request.user?.email,
        userRole: request.user?.role,
        exception,
      },
    );

    response.status(status).json(payload);
  }
}
