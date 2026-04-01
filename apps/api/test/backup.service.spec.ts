import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { BackupService } from '../src/modules/backup/backup.service';
import { LoggingService } from '../src/modules/logging/logging.service';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const { spawn } = jest.requireMock('node:child_process') as {
  spawn: jest.Mock;
};

class MockChildProcess extends EventEmitter {
  stderr = new EventEmitter();
}

describe('BackupService', () => {
  const originalEnv = process.env;
  let workspaceDir: string;
  let loggingService: LoggingService;

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceDir = mkdtempSync(join(tmpdir(), 'denga-backup-'));
    process.env = {
      ...originalEnv,
      DATABASE_URL:
        'postgresql://denga:denga@localhost:5433/denga?schema=public&sslmode=require',
      BACKUP_DIR: 'backups',
      BACKUP_KEEP_COUNT: '10',
    };
    loggingService = {
      info: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggingService;
    spawn.mockImplementation((_command: string, args: string[]) => {
      const child = new MockChildProcess();
      const fileArg = args.find((item) => item.startsWith('--file='));
      const filePath = fileArg?.slice('--file='.length);

      process.nextTick(() => {
        if (filePath) {
          writeFileSync(filePath, 'backup');
        }
        child.emit('close', 0);
      });

      return child;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when no backup exists', () => {
    const service = new BackupService(loggingService);
    expect(service.getLatestBackup({ role: 'ADMIN' })).toBeNull();
  });

  it('creates a backup file and keeps only the latest ten', async () => {
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workspaceDir);
    const service = new BackupService(loggingService);

    for (let index = 0; index < 11; index += 1) {
      await service.createBackup({
        sub: 'user-1',
        email: 'admin@example.com',
        role: 'ADMIN',
      });
    }

    const backups = readdirSync(join(workspaceDir, 'backups'));
    expect(backups).toHaveLength(10);
    expect(service.getLatestBackup({ role: 'ADMIN' })).not.toBeNull();
    cwdSpy.mockRestore();
  });

  it('sanitizes Prisma query params before calling pg_dump', async () => {
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workspaceDir);
    const service = new BackupService(loggingService);

    await service.createBackup({
      sub: 'user-1',
      email: 'admin@example.com',
      role: 'ADMIN',
    });

    const [, args] = spawn.mock.calls[0] as [string, string[]];
    const dbNameArg = args.find((item) => item.startsWith('--dbname='));

    expect(dbNameArg).toBeDefined();
    expect(dbNameArg).not.toContain('schema=');
    expect(dbNameArg).toContain('sslmode=require');
    cwdSpy.mockRestore();
  });

  it('throws when latest backup is missing', async () => {
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workspaceDir);
    const service = new BackupService(loggingService);

    await expect(service.openLatestBackup({ role: 'ADMIN' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    cwdSpy.mockRestore();
  });

  it('rejects non-admin access', async () => {
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workspaceDir);
    const service = new BackupService(loggingService);

    await expect(service.createBackup({ role: 'MEMBER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(() => service.getLatestBackup({ role: 'MEMBER' })).toThrow(ForbiddenException);
    await expect(service.openLatestBackup({ role: 'MEMBER' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    cwdSpy.mockRestore();
  });
});
