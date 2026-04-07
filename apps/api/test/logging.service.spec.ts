jest.mock('node:fs', () => ({
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('../src/modules/common/runtime-config', () => ({
  getApiRuntimeConfig: () => ({
    logDir: 'tmp-logs',
    logLevel: 'info',
  }),
}));

import { existsSync, readFileSync } from 'node:fs';
import { LoggingService } from '../src/modules/logging/logging.service';

describe('LoggingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters, sorts and paginates log records', () => {
    const mockedExistsSync = jest.mocked(existsSync);
    const mockedReadFileSync = jest.mocked(readFileSync);

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      [
        JSON.stringify({
          timestamp: '2026-04-07T10:00:00.000Z',
          level: 'info',
          source: 'api',
          event: 'request_completed',
          message: 'Request completed',
        }),
        JSON.stringify({
          timestamp: '2026-04-07T11:00:00.000Z',
          level: 'error',
          source: 'admin',
          event: 'save_failed',
          message: 'Save failed for taxi category',
        }),
        JSON.stringify({
          timestamp: '2026-04-07T12:00:00.000Z',
          level: 'warn',
          source: 'admin',
          event: 'save_retry',
          message: 'Retry taxi sync',
        }),
      ].join('\n') as never,
    );

    const service = new LoggingService();
    const result = service.readLogs({
      source: 'admin',
      search: 'taxi',
      sortBy: 'event',
      sortDir: 'asc',
      page: 1,
      pageSize: 1,
    });

    expect(result).toEqual({
      items: [
        {
          timestamp: '2026-04-07T11:00:00.000Z',
          level: 'error',
          source: 'admin',
          event: 'save_failed',
          message: 'Save failed for taxi category',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 1,
    });
  });
});
