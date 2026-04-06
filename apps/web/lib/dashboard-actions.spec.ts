import { UnauthorizedError } from './api';
import {
  changePasswordAction,
  createBackupAction,
  downloadLatestBackupAction,
  runDashboardMutation,
  saveSettingsAction,
} from './dashboard-actions';

describe('dashboard actions', () => {
  it('saves settings and reports success', async () => {
    const save = jest.fn().mockResolvedValue({ householdName: 'Denga' });
    const setSettings = jest.fn();
    const setSettingsMessage = jest.fn();

    const result = await saveSettingsAction({
      auth: { accessToken: 'token', user: { email: 'a@b.c', role: 'ADMIN' } },
      settings: {
        householdName: 'Old',
        defaultCurrency: 'EUR',
        telegramMode: 'polling',
        aiModel: 'model',
        clarificationTimeoutMinutes: 30,
        parsingPrompt: 'parse',
        clarificationPrompt: 'clarify',
      },
      formData: new FormData(),
      featureApi: {
        settings: { save },
      } as never,
      onUnauthorized: jest.fn().mockReturnValue(false),
      setSettings,
      setSettingsMessage,
    });

    expect(result).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith({ householdName: 'Denga' });
    expect(setSettingsMessage).toHaveBeenLastCalledWith('Настройки сохранены');
  });

  it('marks backup creation as success', async () => {
    const setLatestBackup = jest.fn();
    const setBackupTaskState = jest.fn();

    await createBackupAction({
      auth: { accessToken: 'token', user: { email: 'a@b.c', role: 'ADMIN' } },
      featureApi: {
        settings: {
          createBackup: jest.fn().mockResolvedValue({ fileName: 'backup.dump' }),
        },
      } as never,
      onUnauthorized: jest.fn().mockReturnValue(false),
      setLatestBackup,
      setBackupTaskState,
    });

    expect(setBackupTaskState).toHaveBeenNthCalledWith(1, {
      status: 'loading',
      error: null,
      message: null,
      currentAction: 'create',
    });
    expect(setBackupTaskState).toHaveBeenLastCalledWith({
      status: 'success',
      error: null,
      message: 'Бэкап backup.dump создан',
      currentAction: 'create',
    });
    expect(setLatestBackup).toHaveBeenCalledWith({ fileName: 'backup.dump' });
  });

  it('marks backup download as error when request fails', async () => {
    const onUnauthorized = jest.fn().mockReturnValue(false);
    const setBackupTaskState = jest.fn();

    await downloadLatestBackupAction({
      auth: { accessToken: 'token', user: { email: 'a@b.c', role: 'ADMIN' } },
      featureApi: {
        settings: {
          downloadLatestBackup: jest.fn().mockRejectedValue(new Error('network failed')),
        },
      } as never,
      latestBackup: { id: '1', fileName: 'backup.dump', sizeBytes: 1, createdAt: '2026-04-07' },
      onUnauthorized,
      onDownload: jest.fn(),
      setBackupTaskState,
    });

    expect(onUnauthorized).toHaveBeenCalled();
    expect(setBackupTaskState).toHaveBeenLastCalledWith({
      status: 'error',
      error: 'network failed',
      message: null,
      currentAction: 'download',
    });
  });

  it('clears session on unauthorized password change', async () => {
    const clearSession = jest.fn();
    const setPasswordState = jest.fn();

    const result = await changePasswordAction({
      auth: { accessToken: 'token', user: { email: 'a@b.c', role: 'ADMIN' } },
      featureApi: {
        settings: {
          changePassword: jest
            .fn()
            .mockRejectedValue(new UnauthorizedError()),
        },
      } as never,
      passwordForm: {
        currentPassword: 'old',
        newPassword: 'new',
        confirmPassword: 'new',
      },
      clearSession,
      setPasswordState,
    });

    expect(result).toBe(false);
    expect(clearSession).toHaveBeenCalledWith('Сессия истекла, войдите снова');
  });

  it('reloads data after a successful mutation', async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);

    const result = await runDashboardMutation({
      auth: { accessToken: 'token', user: { email: 'a@b.c', role: 'ADMIN' } },
      execute: jest.fn().mockResolvedValue(undefined),
      onUnauthorized: jest.fn().mockReturnValue(false),
      fallbackMessage: 'failed',
      onSuccess,
    });

    expect(result).toBe(true);
    expect(onSuccess).toHaveBeenCalled();
  });
});
