import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LoggingService } from '../logging/logging.service';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionService } from './transaction.service';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.transactionService.list(status, type);
  }

  @Get('summary')
  summary() {
    return this.transactionService.summary();
  }

  @Post()
  async create(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Body() dto: CreateTransactionDto,
  ) {
    const transaction = await this.transactionService.createManual(dto, request.user.sub);
    this.loggingService.info('admin', 'transaction_created', 'Manual transaction created', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      transactionId: transaction.id,
      categoryId: transaction.categoryId,
      type: transaction.type,
    });
    return transaction;
  }

  @Patch(':id')
  async update(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    const transaction = await this.transactionService.update(id, dto);
    this.loggingService.info('admin', 'transaction_updated', 'Transaction updated', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      transactionId: id,
    });
    return transaction;
  }

  @Delete(':id')
  async cancel(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Param('id') id: string,
  ) {
    const result = await this.transactionService.cancel(id);
    this.loggingService.info('admin', 'transaction_cancelled', 'Transaction cancelled', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      transactionId: id,
    });
    return result;
  }
}
