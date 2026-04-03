import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';
import { getApiRuntimeConfig } from './modules/common/runtime-config';
import { RuntimeValidationService } from './modules/common/runtime-validation.service';
import { LoggingService } from './modules/logging/logging.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggingService = app.get(LoggingService);
  const runtimeValidationService = app.get(RuntimeValidationService);
  const runtimeConfig = getApiRuntimeConfig();
  runtimeValidationService.ensureOperationalDirectories(runtimeConfig);
  const validation = runtimeValidationService.validateRuntime();

  for (const warning of validation.warnings) {
    loggingService.warn('runtime', 'runtime_validation_warning', warning);
  }

  if (!validation.valid) {
    for (const error of validation.errors) {
      loggingService.error('runtime', 'runtime_validation_error', error);
    }
    throw new Error(`Runtime validation failed: ${validation.errors.join(' | ')}`);
  }

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
