import { Module } from '@nestjs/common';
import { LoggingModule } from '../logging/logging.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [LoggingModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
