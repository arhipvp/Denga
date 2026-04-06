import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TelegramDeliveryModule } from '../telegram/telegram-delivery.module';

@Module({
  imports: [TelegramDeliveryModule],
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
