import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';
import { LoggingService } from './modules/logging/logging.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggingService = app.get(LoggingService);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  loggingService.info('runtime', 'api_bootstrap_started', 'API bootstrap started', {
    port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  });
  await app.listen(port);
  loggingService.info('runtime', 'api_bootstrap_completed', 'API bootstrap completed', {
    port,
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
