import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { LoggingService } from '../logging/logging.service';
import { getApiRuntimeConfig } from '../common/runtime-config';
import type { BackupInfo } from './backup.types';

type Actor = { sub?: string; email?: string; role?: string };

const BACKUP_FILE_PREFIX = 'denga-ops-';
const BACKUP_FILE_EXTENSION = '.dump';
const BACKUP_TABLES = [
  'public."Household"',
  'public."User"',
  'public."Category"',
  'public."Transaction"',
  'public."AppSetting"',
] as const;

@Injectable()
export class BackupService {
  private readonly runtimeConfig = getApiRuntimeConfig();
  private readonly backupDir = join(process.cwd(), this.runtimeConfig.backupDir);

  constructor(private readonly loggingService: LoggingService) {
    mkdirSync(this.backupDir, { recursive: true });
  }

  async createBackup(actor: Actor): Promise<BackupInfo> {
    this.assertAdmin(actor);

    const fileName = `${BACKUP_FILE_PREFIX}${this.buildTimestamp()}-${randomUUID()}${BACKUP_FILE_EXTENSION}`;
    const filePath = join(this.backupDir, fileName);

    try {
      this.ensureDirectoryExists(dirname(filePath));
      await this.runPgDump(filePath);
      this.pruneOldBackups();
      const backup = this.toBackupInfo(filePath);
      this.loggingService.info('backup', 'backup_created', 'Backup created', {
        actorId: actor.sub,
        actorEmail: actor.email,
        fileName: backup.fileName,
        sizeBytes: backup.sizeBytes,
      });
      return backup;
    } catch (error) {
      rmSync(filePath, { force: true });
      this.loggingService.error('backup', 'backup_create_failed', 'Backup creation failed', {
        actorId: actor.sub,
        actorEmail: actor.email,
        error,
      });
      throw error;
    }
  }

  private ensureDirectoryExists(directoryPath: string) {
    mkdirSync(directoryPath, { recursive: true });
  }

  getLatestBackup(actor: Actor): BackupInfo | null {
    this.assertAdmin(actor);
    const latest = this.findLatestBackupPath();
    return latest ? this.toBackupInfo(latest) : null;
  }

  async openLatestBackup(actor: Actor) {
    this.assertAdmin(actor);
    const latest = this.findLatestBackupPath();

    if (!latest) {
      throw new NotFoundException('Backup not found');
    }

    return {
      fileName: this.toBackupInfo(latest).fileName,
      stream: createReadStream(latest),
    };
  }

  private assertAdmin(actor: Actor) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required');
    }
  }

  private buildTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  private async runPgDump(filePath: string) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new InternalServerErrorException('DATABASE_URL is not configured');
    }

    const args = [
      '--format=custom',
      `--file=${filePath}`,
      `--dbname=${databaseUrl}`,
      ...BACKUP_TABLES.map((table) => `--table=${table}`),
    ];

    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: process.env,
      });

      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(
          new InternalServerErrorException(
            `Failed to start pg_dump: ${error.message}`,
          ),
        );
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new InternalServerErrorException(
            `pg_dump failed${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
      });
    });
  }

  private pruneOldBackups() {
    const backupPaths = this.listBackupPaths();
    const removable = backupPaths.slice(this.runtimeConfig.backupKeepCount);

    for (const filePath of removable) {
      rmSync(filePath, { force: true });
    }
  }

  private findLatestBackupPath() {
    return this.listBackupPaths()[0] ?? null;
  }

  private listBackupPaths() {
    if (!existsSync(this.backupDir)) {
      return [] as string[];
    }

    return readdirSync(this.backupDir)
      .filter(
        (fileName) =>
          fileName.startsWith(BACKUP_FILE_PREFIX) &&
          fileName.endsWith(BACKUP_FILE_EXTENSION),
      )
      .map((fileName) => join(this.backupDir, fileName))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  }

  private toBackupInfo(filePath: string): BackupInfo {
    const stats = statSync(filePath);
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

    return {
      id: fileName,
      fileName,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
    };
  }
}
