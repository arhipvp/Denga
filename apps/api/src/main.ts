import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';
import { getApiRuntimeConfig } from './modules/common/runtime-config';
import { LoggingService } from './modules/logging/logging.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggingService = app.get(LoggingService);
  const runtimeConfig = getApiRuntimeConfig();
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

  loggingService.info('runtime', 'api_bootstrap_started', 'API bootstrap started', {
    port: runtimeConfig.port,
    nodeEnv: runtimeConfig.nodeEnv,
  });
  await app.listen(runtimeConfig.port);
  loggingService.info('runtime', 'api_bootstrap_completed', 'API bootstrap completed', {
    port: runtimeConfig.port,
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
