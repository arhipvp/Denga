import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BOOTSTRAP_HOUSEHOLD_ID } from '../common/household.constants';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      where: { householdId: BOOTSTRAP_HOUSEHOLD_ID },
      include: {
        telegramAccounts: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
