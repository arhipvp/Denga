import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HouseholdContextService } from '../src/modules/common/household-context.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { UserService } from '../src/modules/user/user.service';

describe('UserService', () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  const householdContext = {
    getHouseholdId: jest.fn(() => 'bootstrap-household'),
  };

  async function createService() {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany,
              findFirst,
              update,
            },
          },
        },
        {
          provide: HouseholdContextService,
          useValue: householdContext,
        },
      ],
    }).compile();

    return moduleRef.get(UserService);
  }

  beforeEach(() => {
    findMany.mockReset();
    findFirst.mockReset();
    update.mockReset();
    householdContext.getHouseholdId.mockClear();
  });

  it('lists users with safe dashboard fields', async () => {
    const service = await createService();
    findMany.mockResolvedValue([
      {
        id: 'user-1',
        displayName: 'Иван',
        email: 'ivan@example.com',
        role: 'ADMIN',
        createdAt: new Date('2026-04-07T10:00:00.000Z'),
        telegramAccounts: [{ telegramId: '1', username: 'ivan', isActive: true }],
      },
    ]);

    const result = await service.list();

    expect(result[0]).toMatchObject({
      displayName: 'Иван',
      role: 'ADMIN',
      telegramAccounts: [{ isActive: true }],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: 'bootstrap-household' },
        orderBy: { createdAt: 'asc' },
        select: expect.objectContaining({
          role: true,
          createdAt: true,
          telegramAccounts: expect.objectContaining({
            select: expect.objectContaining({
              isActive: true,
            }),
          }),
        }),
      }),
    );
  });

  it('updates a user display name within the current household', async () => {
    const service = await createService();
    findFirst.mockResolvedValue({ id: 'user-1' });
    update.mockResolvedValue({
      id: 'user-1',
      displayName: 'Новое имя',
      email: 'user@example.com',
      role: 'MEMBER',
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      telegramAccounts: [],
    });

    const result = await service.updateDisplayName('user-1', { displayName: '  Новое имя  ' });

    expect(result.displayName).toBe('Новое имя');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', householdId: 'bootstrap-household' },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { displayName: 'Новое имя' },
      }),
    );
  });

  it('throws not found when user is missing', async () => {
    const service = await createService();
    findFirst.mockResolvedValue(null);

    await expect(service.updateDisplayName('missing', { displayName: 'Имя' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
