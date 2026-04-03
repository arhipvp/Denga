import { BackupTelegramDeliveryService } from '../src/modules/backup/backup-telegram-delivery.service';
import { BackupSchedulerService } from '../src/modules/backup/backup-scheduler.service';

describe('BackupTelegramDeliveryService', () => {
  const findFirst = jest.fn();
  const createBackupArtifact = jest.fn();
  const sendTelegramDocument = jest.fn();
  const loggingService = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new BackupTelegramDeliveryService(
    {
      user: {
        findFirst,
      },
    } as never,
    {
      createBackupArtifact,
    } as never,
    {
      sendTelegramDocument,
    } as never,
    loggingService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects the first admin with active telegram account', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      telegramAccounts: [{ telegramId: '123456' }],
    });

    await expect(service.findRecipient()).resolves.toEqual({
      userId: 'admin-1',
      telegramId: '123456',
    });
  });

  it('skips when no admin telegram recipient exists', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.sendScheduledBackup()).resolves.toEqual({
      status: 'skipped',
    });
    expect(loggingService.warn).toHaveBeenCalled();
    expect(createBackupArtifact).not.toHaveBeenCalled();
  });

  it('creates a backup and sends it as telegram document', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      telegramAccounts: [{ telegramId: '123456' }],
    });
    createBackupArtifact.mockResolvedValue({
      info: {
        fileName: 'backup.dump',
        sizeBytes: 123,
        createdAt: '2026-04-04T09:00:00.000Z',
      },
      filePath: '/tmp/backup.dump',
    });
    sendTelegramDocument.mockResolvedValue({ message_id: 1 });

    await expect(service.sendScheduledBackup()).resolves.toEqual({
      status: 'sent',
      recipientTelegramId: '123456',
      fileName: 'backup.dump',
    });
    expect(sendTelegramDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '123456',
        filePath: '/tmp/backup.dump',
        fileName: 'backup.dump',
      }),
    );
  });

  it('logs and swallows telegram delivery failures', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      telegramAccounts: [{ telegramId: '123456' }],
    });
    createBackupArtifact.mockResolvedValue({
      info: {
        fileName: 'backup.dump',
        sizeBytes: 123,
        createdAt: '2026-04-04T09:00:00.000Z',
      },
      filePath: '/tmp/backup.dump',
    });
    sendTelegramDocument.mockRejectedValue(new Error('telegram failed'));

    await expect(service.sendScheduledBackup()).resolves.toEqual({
      status: 'failed',
    });
    expect(loggingService.error).toHaveBeenCalled();
  });
});

describe('BackupSchedulerService', () => {
  const sendScheduledBackup = jest.fn();
  const loggingService = {
    info: jest.fn(),
  };

  const service = new BackupSchedulerService(
    {
      sendScheduledBackup,
    } as never,
    loggingService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('triggers scheduled backup delivery on cron tick', async () => {
    sendScheduledBackup.mockResolvedValue({ status: 'sent' });

    await service.handleScheduledBackup();

    expect(loggingService.info).toHaveBeenCalled();
    expect(sendScheduledBackup).toHaveBeenCalledTimes(1);
  });
});
