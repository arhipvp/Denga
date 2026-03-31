import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionLoggingFilter } from './http-exception.filter';
import { LoggingService } from './logging.service';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Module({
  providers: [
    LoggingService,
    LogsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionLoggingFilter,
    },
  ],
  controllers: [LogsController],
  exports: [LoggingService, LogsService],
})
export class LoggingModule {}
