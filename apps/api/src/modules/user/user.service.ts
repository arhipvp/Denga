import { Injectable, NotFoundException } from '@nestjs/common';
import { HouseholdContextService } from '../common/household-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly householdContext: HouseholdContextService,
  ) {}

  private readonly userSelect = {
    id: true,
    displayName: true,
    email: true,
    role: true,
    createdAt: true,
    telegramAccounts: {
      select: {
        telegramId: true,
        username: true,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    },
  } as const;

  list() {
    return this.prisma.user.findMany({
      where: { householdId: this.householdContext.getHouseholdId() },
      select: this.userSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateDisplayName(id: string, dto: UpdateUserDto) {
    const householdId = this.householdContext.getHouseholdId();
    const existingUser = await this.prisma.user.findFirst({
      where: { id, householdId },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('Пользователь не найден');
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        displayName: dto.displayName.trim(),
      },
      select: this.userSelect,
    });
  }
}
