import { Module } from '@nestjs/common';
import { CategoryModule } from '../category/category.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';

@Module({
  imports: [CategoryModule, SettingsModule],
  controllers: [TransactionController],
  providers: [TransactionService],
  exports: [TransactionService],
})
export class TransactionModule {}
