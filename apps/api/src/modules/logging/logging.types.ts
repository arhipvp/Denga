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
