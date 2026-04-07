import { CategoryType } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const categories = await this.prisma.category.findMany({
      where: { householdId: BOOTSTRAP_HOUSEHOLD_ID },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    } as any);

    return this.buildCategoryTree(categories);
  }

  async create(dto: CreateCategoryDto) {
    const type = this.mapType(dto.type);
    const parentId = dto.parentId ?? null;
    const parent = await this.validateParent(parentId, type);
    await this.ensureSiblingNameIsAvailable({
      householdId: BOOTSTRAP_HOUSEHOLD_ID,
      parentId,
      type,
      name: dto.name,
    });

    const category = await this.prisma.category.create({
      data: {
        householdId: BOOTSTRAP_HOUSEHOLD_ID,
        name: dto.name,
        type,
        isActive: dto.isActive ?? true,
        parentId: parent?.id ?? null,
      },
    } as any);

    return this.serializeCategory(category, parent ?? null, []);
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const current = (await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        transactions: {
          select: { id: true },
          take: 1,
        },
      },
    } as any)) as any;

    if (!current || current.householdId !== BOOTSTRAP_HOUSEHOLD_ID) {
      throw new NotFoundException('Category not found');
    }

    const type = dto.type ? this.mapType(dto.type) : current.type;
    const parentId = dto.parentId === undefined ? current.parentId : dto.parentId;

    if (dto.type && current.transactions.length > 0 && type !== current.type) {
      throw new BadRequestException('Cannot change category type with existing transactions');
    }

    if (dto.parentId !== undefined && dto.parentId !== current.parentId) {
      if (dto.parentId === current.id) {
        throw new BadRequestException('Category cannot be its own parent');
      }

      if (dto.parentId !== null && current.children.length > 0) {
        throw new BadRequestException('Parent category cannot be moved under another category');
      }

      if (dto.parentId === null && current.transactions.length > 0) {
        throw new BadRequestException('Leaf category with transactions cannot become a parent category');
      }
    }

    const parent = await this.validateParent(parentId, type, current.id);
    await this.ensureSiblingNameIsAvailable({
      householdId: current.householdId,
      parentId: parentId ?? null,
      type,
      name: dto.name ?? current.name,
      excludeId: current.id,
    });

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.type ? { type } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.parentId !== undefined ? { parentId } : {}),
      },
    } as any);

    return this.serializeCategory(category, parent ?? null, []);
  }

  async remove(id: string) {
    const category = (await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: {
          where: {
            isActive: true,
          },
          select: { id: true },
        },
      },
    } as any)) as any;

    if (!category || category.householdId !== BOOTSTRAP_HOUSEHOLD_ID) {
      throw new NotFoundException('Category not found');
    }

    if (category.children.length > 0) {
      throw new BadRequestException('Cannot disable a parent category with active children');
    }

    await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }

  private mapType(type: 'income' | 'expense') {
    return type === 'income' ? CategoryType.INCOME : CategoryType.EXPENSE;
  }

  private async validateParent(
    parentId: string | null,
    type: CategoryType,
    currentId?: string,
  ) {
    if (!parentId) {
      return null;
    }

    const parent = (await this.prisma.category.findUnique({
      where: { id: parentId },
      include: {
        parent: true,
      },
    } as any)) as any;

    if (!parent || parent.householdId !== BOOTSTRAP_HOUSEHOLD_ID) {
      throw new NotFoundException('Parent category not found');
    }

    if (currentId && parent.id === currentId) {
      throw new BadRequestException('Category cannot be its own parent');
    }

    if (parent.parentId) {
      throw new BadRequestException('Only two category levels are supported');
    }

    if (parent.type !== type) {
      throw new BadRequestException('Parent category type must match child category type');
    }

    return parent;
  }

  private async ensureSiblingNameIsAvailable(input: {
    householdId: string;
    parentId: string | null;
    type: CategoryType;
    name: string;
    excludeId?: string;
  }) {
    const duplicate = await this.prisma.category.findFirst({
      where: {
        householdId: input.householdId,
        parentId: input.parentId,
        type: input.type,
        name: input.name,
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { id: true },
    } as any);

    if (duplicate) {
      throw new BadRequestException('Category name must be unique within the selected parent');
    }
  }

  private buildCategoryTree(
    categories: Array<{
      id: string;
      householdId: string;
      parentId: string | null;
      name: string;
      type: CategoryType;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    const byParent = new Map<string | null, typeof categories>();

    for (const category of categories) {
      const items = byParent.get(category.parentId) ?? [];
      items.push(category);
      byParent.set(category.parentId, items);
    }

    const serializeNode = (
      category: (typeof categories)[number],
      parentPath?: string,
    ): ReturnType<CategoryService['serializeCategory']> => {
      const displayPath = parentPath ? `${parentPath} / ${category.name}` : category.name;
      const children: Array<ReturnType<CategoryService['serializeCategory']>> = (
        byParent.get(category.id) ?? []
      ).map((item) =>
        serializeNode(item, displayPath),
      );

      return this.serializeCategory(category, null, children, displayPath);
    };

    return (byParent.get(null) ?? []).map((category) => serializeNode(category));
  }

  private serializeCategory(
    category: {
      id: string;
      parentId: string | null;
      name: string;
      type: CategoryType;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    },
    parent: { name: string } | null,
    children: Array<Record<string, unknown>>,
    displayPath?: string,
  ) {
    const resolvedDisplayPath =
      displayPath ?? (parent ? `${parent.name} / ${category.name}` : category.name);

    return {
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      type: category.type,
      isActive: category.isActive,
      isLeaf: category.parentId !== null,
      displayPath: resolvedDisplayPath,
      children,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
