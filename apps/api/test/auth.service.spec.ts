import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService.changePassword', () => {
  const signAsync = jest.fn();
  const findUnique = jest.fn();
  const update = jest.fn();

  const service = new AuthService(
    {
      user: {
        findUnique,
        update,
      },
    } as any,
    {
      signAsync,
    } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates password hash when current password is valid', async () => {
    const currentHash = await bcrypt.hash('old-password', 10);
    findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: currentHash,
    });
    update.mockResolvedValue({});

    await expect(
      service.changePassword('user-1', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
      }),
    ).resolves.toEqual({ success: true });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
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
