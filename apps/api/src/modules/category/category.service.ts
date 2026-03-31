import { CategoryType } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.category.findMany({
      where: { householdId: BOOTSTRAP_HOUSEHOLD_ID },
      orderBy: { name: 'asc' },
    });
  }

  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        name: dto.name,
        type: dto.type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE,
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateCategoryDto) {
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.type
          ? {
              type:
                dto.type === 'income'
                  ? CategoryType.INCOME
                  : CategoryType.EXPENSE,
            }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }
}
