import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { BackupModule } from './backup/backup.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { HealthModule } from './health/health.module';
import { LoggingModule } from './logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';
import { TelegramModule } from './telegram/telegram.module';
import { TransactionModule } from './transaction/transaction.module';
import { UserModule } from './user/user.module';
import { CommonModule } from './common/common.module';
import { getApiRuntimeConfig } from './common/runtime-config';

const runtimeConfig = getApiRuntimeConfig();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    CommonModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), runtimeConfig.uploadDir),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    LoggingModule,
    BackupModule,
    HealthModule,
    AuthModule,
    CategoryModule,
    TransactionModule,
    UserModule,
    SettingsModule,
    TelegramModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
