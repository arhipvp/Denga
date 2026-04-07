import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCategoryDto } from '../src/modules/category/dto/category.dto';
import { CreateTransactionDto } from '../src/modules/transaction/dto/transaction.dto';
import { UpdateUserDto } from '../src/modules/user/dto/update-user.dto';

describe('DTO validation', () => {
  it('rejects invalid transaction payloads', () => {
    const dto = new CreateTransactionDto();
    dto.type = 'expense';
    dto.amount = -1;
    dto.occurredAt = 'bad-date';
    dto.categoryId = '';

    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty category names', () => {
    const dto = new CreateCategoryDto();
    dto.name = '';
    dto.type = 'expense';

    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects blank user display names', () => {
    const dto = plainToInstance(UpdateUserDto, { displayName: '   ' });

    const errors = validateSync(dto);

    expect(errors.length).toBeGreaterThan(0);
  });
});
