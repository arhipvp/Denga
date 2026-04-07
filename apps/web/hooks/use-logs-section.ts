'use client';

import { useMemo, useState } from 'react';
import type { LogEntry, LogListFilters } from '../lib/types';

const defaultLogFilters: LogListFilters = {
  level: 'all',
  source: 'all',
  search: '',
  sortBy: 'timestamp',
  sortDir: 'desc',
  page: 1,
  pageSize: 10,
};

export function useLogsSection(logs: LogEntry[]) {
  const [filters, setFilters] = useState<LogListFilters>(defaultLogFilters);

  const logSources = useMemo(() => {
    return Array.from(new Set(logs.map((item) => item.source))).sort();
  }, [logs]);

  return {
    filters,
    setFilters,
    logSources,
  };
}
