'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { UnauthorizedError } from '../lib/api';
import {
  changePasswordAction,
  createBackupAction,
  downloadLatestBackupAction,
  runDashboardMutation,
  saveOperationAction,
  saveSettingsAction,
} from '../lib/dashboard-actions';
import { type Section } from '../lib/types';
import { useAuthSession } from './use-auth-session';
import { useCategoriesSection } from './use-categories-section';
import { useDashboardData } from './use-dashboard-data';
import { useLogsSection } from './use-logs-section';
import { useOperationsSection } from './use-operations-section';
import { useSettingsSection } from './use-settings-section';

function triggerBrowserDownload(payload: { blob: Blob; fileName: string | null }) {
  const objectUrl = URL.createObjectURL(payload.blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = payload.fileName ?? 'denga-backup.dump';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return link.download;
}

export function useDashboardController(apiUrl: string | null) {
  const { auth, saveAuth, clearAuth } = useAuthSession();
  const data = useDashboardData(apiUrl);
  const {
    featureApi,
    categories,
    logs,
    settings,
    latestBackup,
    setSettings,
    setLatestBackup,
    setError,
    setLogsError,
    resetData,
    reloadData,
    reloadLogs,
  } = data;
  const [section, setSection] = useState<Section>('overview');
  const operations = useOperationsSection(categories);
  const categorySection = useCategoriesSection(categories);
  const settingsSection = useSettingsSection();
  const logsSection = useLogsSection(logs);

  const resetDashboardUi = useCallback(() => {
    operations.reset();
    categorySection.reset();
    settingsSection.reset();
  }, [categorySection, operations, settingsSection]);

  const clearSession = useCallback(
    (message = 'Сессия истекла, войдите снова') => {
      clearAuth();
      resetData();
      resetDashboardUi();
      setError(message);
    },
    [clearAuth, resetDashboardUi, resetData, setError],
  );

  const handleApiError = useCallback(
    (candidate: unknown, fallbackMessage: string) => {
      if (candidate instanceof UnauthorizedError) {
        clearSession(candidate.message);
        return true;
      }

      setError(candidate instanceof Error ? candidate.message : fallbackMessage);
      return false;
    },
    [clearSession, setError],
  );

  const loadDashboard = useCallback(async () => {
    if (!auth) {
      return;
    }

    try {
      await reloadData(auth.accessToken, operations.statusFilter, operations.typeFilter);
    } catch (error) {
      handleApiError(error, 'Не удалось загрузить данные');
    }
  }, [auth, handleApiError, operations.statusFilter, operations.typeFilter, reloadData]);

  const loadLogs = useCallback(async () => {
    if (!auth || section !== 'logs') {
      return;
    }

    try {
      await reloadLogs(auth.accessToken, logsSection.logLevelFilter, logsSection.logSourceFilter);
    } catch (error) {
      if (!handleApiError(error, 'Не удалось загрузить логи')) {
        setLogsError(error instanceof Error ? error.message : 'Не удалось загрузить логи');
      }
    }
  }, [auth, handleApiError, logsSection.logLevelFilter, logsSection.logSourceFilter, reloadLogs, section, setLogsError]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);

      setError(null);

      try {
        const payload = await featureApi.auth.login(
          formData.get('email'),
          formData.get('password'),
        );
        saveAuth(payload);
        resetData();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Не удалось выполнить вход');
      }
    },
    [featureApi.auth, resetData, saveAuth, setError],
  );

  const handleSaveSettings = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await saveSettingsAction({
        auth,
        settings,
        formData: new FormData(event.currentTarget),
        featureApi,
        onUnauthorized: handleApiError,
        setSettings,
        setSettingsMessage: settingsSection.setSettingsMessage,
      });
    },
    [auth, featureApi, handleApiError, setSettings, settings, settingsSection.setSettingsMessage],
  );

  const handleCreateBackup = useCallback(async () => {
    await createBackupAction({
      auth,
      featureApi,
      onUnauthorized: handleApiError,
      setLatestBackup,
      setBackupTaskState: settingsSection.setBackupTaskState,
    });
  }, [auth, featureApi, handleApiError, setLatestBackup, settingsSection.setBackupTaskState]);

  const handleDownloadLatestBackup = useCallback(async () => {
    await downloadLatestBackupAction({
      auth,
      featureApi,
      latestBackup,
      onUnauthorized: handleApiError,
      onDownload: triggerBrowserDownload,
      setBackupTaskState: settingsSection.setBackupTaskState,
    });
  }, [auth, featureApi, handleApiError, latestBackup, settingsSection.setBackupTaskState]);

  const handleChangePassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await changePasswordAction({
        auth,
        featureApi,
        passwordForm: settingsSection.passwordState.form,
        clearSession,
        setPasswordState: settingsSection.setPasswordState,
      });
    },
    [auth, clearSession, featureApi, settingsSection.passwordState.form, settingsSection.setPasswordState],
  );

  const handleSaveOperation = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await saveOperationAction({
        auth,
        featureApi,
        operationForm: operations.operationForm,
        onUnauthorized: handleApiError,
        onSaved: loadDashboard,
        onReset: operations.reset,
      });
    },
    [auth, featureApi, handleApiError, loadDashboard, operations.operationForm, operations.reset],
  );

  const handleCancelOperation = useCallback(
    async (id: string) => {
      await runDashboardMutation({
        auth,
        execute: (token) => featureApi.operations.cancel(token, id),
        onUnauthorized: handleApiError,
        fallbackMessage: 'Не удалось отменить операцию',
        onSuccess: loadDashboard,
      });
    },
    [auth, featureApi.operations, handleApiError, loadDashboard],
  );

  const handleSaveCategory = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await runDashboardMutation({
        auth,
        execute: (token) =>
          featureApi.categories.save(token, {
            id: categorySection.categoryForm.id,
            name: categorySection.categoryForm.name.trim(),
            type: categorySection.categoryForm.type,
            isActive: categorySection.categoryForm.isActive,
          }),
        onUnauthorized: handleApiError,
        fallbackMessage: 'Не удалось сохранить категорию',
        onSuccess: async () => {
          categorySection.reset();
          await loadDashboard();
        },
      });
    },
    [auth, categorySection, featureApi.categories, handleApiError, loadDashboard],
  );

  const handleDeactivateCategory = useCallback(
    async (id: string) => {
      await runDashboardMutation({
        auth,
        execute: (token) => featureApi.categories.deactivate(token, id),
        onUnauthorized: handleApiError,
        fallbackMessage: 'Не удалось отключить категорию',
        onSuccess: loadDashboard,
      });
    },
    [auth, featureApi.categories, handleApiError, loadDashboard],
  );

  const handleRestoreCategory = useCallback(
    async (id: string) => {
      await runDashboardMutation({
        auth,
        execute: (token) => featureApi.categories.restore(token, id),
        onUnauthorized: handleApiError,
        fallbackMessage: 'Не удалось включить категорию',
        onSuccess: loadDashboard,
      });
    },
    [auth, featureApi.categories, handleApiError, loadDashboard],
  );

  return {
    auth,
    clearSession,
    section,
    setSection,
    operations,
    categorySection,
    settingsSection,
    logsSection,
    data,
    handlers: {
      handleLogin,
      handleSaveSettings,
      handleCreateBackup,
      handleDownloadLatestBackup,
      handleChangePassword,
      handleSaveOperation,
      handleCancelOperation,
      handleSaveCategory,
      handleDeactivateCategory,
      handleRestoreCategory,
      loadLogs,
    },
  };
}
