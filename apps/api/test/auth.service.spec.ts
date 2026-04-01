import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService', () => {
  const signAsync = jest.fn();
  const findUnique = jest.fn();
  const update = jest.fn();
  const loggingService = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const service = new AuthService(
    {
      user: {
        findUnique,
        update,
      },
    } as never,
    {
      signAsync,
    } as never,
    loggingService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns access token when credentials are valid', async () => {
    findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash('secret', 10),
    });
    signAsync.mockResolvedValue('signed-token');

    await expect(
      service.login({ email: 'admin@example.com', password: 'secret' }),
    ).resolves.toEqual({
      accessToken: 'signed-token',
      user: {
        sub: 'user-1',
        email: 'admin@example.com',
        role: 'ADMIN',
      },
    });
  });

  it('throws when login credentials are invalid', async () => {
    findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash('secret', 10),
    });

    await expect(
      service.login({ email: 'admin@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates password hash when current password is valid', async () => {
    const currentHash = await bcrypt.hash('old-password', 10);
    findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      passwordHash: currentHash,
    });
    update.mockResolvedValue({});

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }),
    ).resolves.toEqual({ success: true });

    expect(update).toHaveBeenCalledTimes(1);

    const updatePayload = update.mock.calls[0][0];
    expect(updatePayload.where).toEqual({ id: 'user-1' });
    expect(updatePayload.data.passwordHash).not.toBe(currentHash);
    await expect(
      bcrypt.compare('new-password', updatePayload.data.passwordHash),
    ).resolves.toBe(true);
  });

  it('throws when current password is invalid', async () => {
    findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: await bcrypt.hash('old-password', 10),
    });

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(update).not.toHaveBeenCalled();
  });
});
