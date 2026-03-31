import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateTransactionDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionService } from './transaction.service';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

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
  create(@Body() dto: CreateTransactionDto) {
    return this.transactionService.createManual(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactionService.update(id, dto);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.transactionService.cancel(id);
  }
}
