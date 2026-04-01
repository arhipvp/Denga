import { Injectable } from '@nestjs/common';
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getApiRuntimeConfig } from '../common/runtime-config';
import { LogLevel, LogRecord } from './logging.types';

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

@Injectable()
export class LoggingService {
  private readonly runtimeConfig = getApiRuntimeConfig();
  private readonly logDir = this.runtimeConfig.logDir;
  private readonly logFile = join(process.cwd(), this.logDir, 'app.log');
  private readonly minLevel = this.resolveLogLevel(this.runtimeConfig.logLevel);

  constructor() {
    mkdirSync(join(process.cwd(), this.logDir), { recursive: true });
  }

  debug(source: string, event: string, message: string, context?: Record<string, unknown>) {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      source,
      event,
      message,
      context,
    });
  }

  info(source: string, event: string, message: string, context?: Record<string, unknown>) {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      source,
      event,
      message,
      context,
    });
  }

  warn(source: string, event: string, message: string, context?: Record<string, unknown>) {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      source,
      event,
      message,
      context,
    });
  }

  error(source: string, event: string, message: string, context?: Record<string, unknown>) {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      source,
      event,
      message,
      context,
    });
  }

  readLogs(filters: { level?: string; source?: string; limit?: number }) {
    if (!existsSync(this.logFile)) {
      return [] as LogRecord[];
    }

    const rows = readFileSync(this.logFile, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as LogRecord;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogRecord => Boolean(entry));

    const filtered = rows.filter((entry) => {
      if (filters.level && entry.level !== filters.level) {
        return false;
      }
      if (filters.source && entry.source !== filters.source) {
        return false;
      }
      return true;
    });

    return filtered.slice(-(filters.limit ?? 100)).reverse();
  }

  private write(record: LogRecord) {
    if (levelWeights[record.level] < levelWeights[this.minLevel]) {
      return;
    }

    const sanitized = {
      ...record,
      context: this.sanitize(record.context),
    };
    const line = JSON.stringify(sanitized);
    const printer =
      sanitized.level === 'error'
        ? console.error
        : sanitized.level === 'warn'
          ? console.warn
          : console.log;

    printer(line);
    appendFileSync(this.logFile, `${line}\n`, 'utf8');
  }

  private resolveLogLevel(value?: string): LogLevel {
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
      return value;
    }
    return 'info';
  }

  private sanitize(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.shouldRedact(key) ? '[REDACTED]' : this.sanitize(item),
        ]),
      );
    }

    return value;
  }

  private shouldRedact(key: string) {
    const normalized = key.toLowerCase();
    return (
      normalized.includes('password') ||
      normalized.includes('token') ||
      normalized.includes('secret') ||
      normalized === 'authorization' ||
      normalized.endsWith('authorization')
    );
  }
}
