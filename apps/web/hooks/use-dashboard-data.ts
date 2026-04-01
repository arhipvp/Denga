'use client';

import { useState } from 'react';
import type { LogEntry, Settings, Summary, Transaction, User, Category } from '../lib/types';
import { createApiClient } from '../lib/api';

export function useDashboardData(apiUrl: string | null) {
  const apiClient = createApiClient({ apiUrl });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const resetData = () => {
    setTransactions([]);
    setCategories([]);
    setUsers([]);
    setSettings(null);
    setSummary(null);
    setLogs([]);
    setError(null);
    setLogsError(null);
    setLoading(false);
    setLogsLoading(false);
  };

  const reloadData = async (
    token: string,
    status: 'all' | 'confirmed' | 'cancelled',
    type: 'all' | 'income' | 'expense',
  ) => {
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();

      if (status !== 'all') {
        query.set('status', status);
      }

      if (type !== 'all') {
        query.set('type', type);
      }

      const [transactionData, categoryData, userData, settingsData, summaryData] =
        await Promise.all([
          apiClient.request<Transaction[]>(
            `/transactions${query.toString() ? `?${query.toString()}` : ''}`,
            token,
          ),
          apiClient.request<Category[]>('/categories', token),
          apiClient.request<User[]>('/users', token),
          apiClient.request<Settings>('/settings', token),
          apiClient.request<Summary>('/transactions/summary', token),
        ]);

      setTransactions(transactionData);
      setCategories(categoryData);
      setUsers(userData);
      setSettings(settingsData);
      setSummary(summaryData);
    } finally {
      setLoading(false);
    }
  };

  const reloadLogs = async (
    token: string,
    level: 'all' | LogEntry['level'],
    source: string,
  ) => {
    setLogsLoading(true);
    setLogsError(null);

    try {
      const query = new URLSearchParams();
      query.set('limit', '100');

      if (level !== 'all') {
        query.set('level', level);
      }

      if (source !== 'all') {
        query.set('source', source);
      }

      const nextLogs = await apiClient.request<LogEntry[]>(
        `/logs?${query.toString()}`,
        token,
      );
      setLogs(nextLogs);
    } finally {
      setLogsLoading(false);
    }
  };

  return {
    apiClient,
    transactions,
    categories,
    users,
    settings,
    setSettings,
    summary,
    logs,
    loading,
    error,
    setError,
    logsError,
    setLogsError,
    logsLoading,
    resetData,
    reloadData,
    reloadLogs,
  };
}
