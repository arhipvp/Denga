'use client';

import { useMemo, useState } from 'react';
import type { LogEntry } from '../lib/types';

export function useLogsSection(logs: LogEntry[]) {
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | LogEntry['level']>('all');
  const [logSourceFilter, setLogSourceFilter] = useState('all');

  const logSources = useMemo(() => {
    return Array.from(new Set(logs.map((item) => item.source))).sort();
  }, [logs]);

  return {
    logLevelFilter,
    setLogLevelFilter,
    logSourceFilter,
    setLogSourceFilter,
    logSources,
  };
}
