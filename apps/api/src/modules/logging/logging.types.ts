export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogRecord = {
  timestamp: string;
  level: LogLevel;
  source: string;
  event: string;
  message: string;
  context?: Record<string, unknown>;
};

export type LogActor = {
  id?: string;
  email?: string;
  role?: string;
};

export type LogSortField = 'timestamp' | 'level' | 'source' | 'event';

export type ReadLogsFilters = {
  level?: string;
  source?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
};

export type PagedLogRecords = {
  items: LogRecord[];
  total: number;
  page: number;
  pageSize: number;
};
