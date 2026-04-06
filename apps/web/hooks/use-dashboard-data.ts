'use client';

import { useCallback, useMemo, useState } from 'react';
import { createApiClient } from '../lib/api';
import { createAsyncState } from '../lib/async-state';
import { createDashboardFeatureApi, DashboardDataLoadError } from '../lib/dashboard-api';
import type {
  BackupInfo,
  Category,
  LogEntry,
  Settings,
  Summary,
  Transaction,
  User,
} from '../lib/types';

export function useDashboardData(apiUrl: string | null) {
  const apiClient = useMemo(() => createApiClient({ apiUrl }), [apiUrl]);
  const featureApi = useMemo(() => createDashboardFeatureApi(apiClient), [apiClient]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [latestBackup, setLatestBackup] = useState<BackupInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mainState, setMainState] = useState(createAsyncState);
  const [logsState, setLogsState] = useState(createAsyncState);

  const setLoading = useCallback((loading: boolean) => {
    setMainState((current) => ({
      ...current,
      status: loading ? 'loading' : current.error ? 'error' : 'idle',
    }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setMainState((current) => ({
      ...current,
      error,
      status: error ? 'error' : current.status === 'loading' ? 'loading' : 'idle',
    }));
  }, []);

  const setLogsLoading = useCallback((loading: boolean) => {
    setLogsState((current) => ({
      ...current,
      status: loading ? 'loading' : current.error ? 'error' : 'idle',
    }));
  }, []);

  const setLogsError = useCallback((error: string | null) => {
    setLogsState((current) => ({
      ...current,
      error,
      status: error ? 'error' : current.status === 'loading' ? 'loading' : 'idle',
    }));
  }, []);

  const resetData = useCallback(() => {
    setTransactions([]);
    setCategories([]);
    setUsers([]);
    setSettings(null);
    setLatestBackup(null);
    setSummary(null);
    setLogs([]);
    setMainState(createAsyncState());
    setLogsState(createAsyncState());
  }, []);

  const reloadData = useCallback(
    async (
      token: string,
      status: 'all' | 'confirmed' | 'cancelled',
      type: 'all' | 'income' | 'expense',
    ) => {
      setLoading(true);
      setError(null);

      try {
        const dataset = await featureApi.dataset.loadMain(token, { status, type });

        setTransactions(dataset.transactions);
        setCategories(dataset.categories);
        setUsers(dataset.users);
        setSettings(dataset.settings);
        setLatestBackup(dataset.latestBackup);
        setSummary(dataset.summary);
        setMainState({ status: 'success', error: null });
      } catch (error) {
        if (error instanceof DashboardDataLoadError) {
          throw new Error(`${error.message}: ${error.path}`);
        }

        throw error;
      } finally {
        setLoading(false);
      }
    },
    [featureApi, setError, setLoading],
  );

  const reloadLogs = useCallback(
    async (
      token: string,
      level: 'all' | LogEntry['level'],
      source: string,
    ) => {
      setLogsLoading(true);
      setLogsError(null);

      try {
        const nextLogs = await featureApi.dataset.loadLogs(token, { level, source });
        setLogs(nextLogs);
        setLogsState({ status: 'success', error: null });
      } catch (error) {
        if (error instanceof DashboardDataLoadError) {
          throw new Error(`${error.message}: ${error.path}`);
        }

        throw error;
      } finally {
        setLogsLoading(false);
      }
    },
    [featureApi, setLogsError, setLogsLoading],
  );

  return {
    apiClient,
    featureApi,
    transactions,
    categories,
    users,
    settings,
    setSettings,
    latestBackup,
    setLatestBackup,
    summary,
    logs,
    loading: mainState.status === 'loading',
    error: mainState.error,
    setError,
    logsError: logsState.error,
    setLogsError,
    logsLoading: logsState.status === 'loading',
    resetData,
    reloadData,
    reloadLogs,
  };
}
