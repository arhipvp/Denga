describe('prisma seed', () => {
  const bcryptHash = jest.fn().mockResolvedValue('hashed-password');
  const householdUpsert = jest.fn().mockResolvedValue({ id: 'bootstrap-household' });
  const userUpsert = jest.fn().mockResolvedValue({ id: 'admin-user' });
  const telegramAccountUpsert = jest.fn().mockResolvedValue({});
  const appSettingUpsert = jest.fn().mockResolvedValue({});
  const categoryCreate = jest.fn();
  const categoryUpdate = jest.fn();
  const categoryUpsert = jest.fn();
  const categoryDelete = jest.fn();
  const disconnect = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    delete process.env.ADMIN_TELEGRAM_ID;
    delete process.env.SECOND_USER_TELEGRAM_ID;
  });

  it('does not perform any category mutations during seed execution', async () => {
    jest.doMock('dotenv/config', () => ({}), { virtual: true });
    jest.doMock('bcrypt', () => ({ __esModule: true, default: { hash: bcryptHash } }));
    jest.doMock('@prisma/client', () => ({
      __esModule: true,
      UserRole: {
        ADMIN: 'ADMIN',
        MEMBER: 'MEMBER',
      },
      PrismaClient: jest.fn(() => ({
        household: { upsert: householdUpsert },
        user: { upsert: userUpsert },
        telegramAccount: { upsert: telegramAccountUpsert },
        appSetting: { upsert: appSettingUpsert },
        category: {
          create: categoryCreate,
          update: categoryUpdate,
          upsert: categoryUpsert,
          delete: categoryDelete,
        },
        $disconnect: disconnect,
      })),
    }));

    await import('../../../prisma/seed');
    await new Promise(process.nextTick);

    expect(householdUpsert).toHaveBeenCalled();
    expect(userUpsert).toHaveBeenCalled();
    expect(appSettingUpsert).toHaveBeenCalled();
    expect(categoryCreate).not.toHaveBeenCalled();
    expect(categoryUpdate).not.toHaveBeenCalled();
    expect(categoryUpsert).not.toHaveBeenCalled();
    expect(categoryDelete).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
