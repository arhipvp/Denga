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
  const logsSection = useLogsSection(logs.items);
  const {
    filters: operationFilters,
    operationForm,
    reset: resetOperations,
  } = operations;
  const {
    categoryForm,
    setCategoryMessage,
    reset: resetCategories,
  } = categorySection;
  const {
    setSettingsMessage,
    setBackupTaskState,
    passwordState,
    setPasswordState,
    reset: resetSettings,
  } = settingsSection;
  const { filters: logFilters } = logsSection;

  const resetDashboardUi = useCallback(() => {
    resetOperations();
    resetCategories();
    resetSettings();
  }, [resetCategories, resetOperations, resetSettings]);

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

  const handleCategoryApiError = useCallback(
    (candidate: unknown) => {
      if (candidate instanceof UnauthorizedError) {
        clearSession(candidate.message);
        return true;
      }

      return false;
    },
    [clearSession],
  );

  const loadDashboard = useCallback(async () => {
    if (!auth) {
      return;
    }

    try {
      await reloadData(auth.accessToken, operationFilters);
    } catch (error) {
      handleApiError(error, 'Не удалось загрузить данные');
    }
  }, [auth, handleApiError, operationFilters, reloadData]);

  const loadLogs = useCallback(async () => {
    if (!auth || section !== 'logs') {
      return;
    }

    try {
      await reloadLogs(auth.accessToken, logFilters);
    } catch (error) {
      if (!handleApiError(error, 'Не удалось загрузить логи')) {
        setLogsError(error instanceof Error ? error.message : 'Не удалось загрузить логи');
      }
    }
  }, [auth, handleApiError, logFilters, reloadLogs, section, setLogsError]);

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
        setSettingsMessage,
      });
    },
    [auth, featureApi, handleApiError, setSettings, setSettingsMessage, settings],
  );

  const handleCreateBackup = useCallback(async () => {
    await createBackupAction({
      auth,
      featureApi,
      onUnauthorized: handleApiError,
      setLatestBackup,
      setBackupTaskState,
    });
  }, [auth, featureApi, handleApiError, setBackupTaskState, setLatestBackup]);

  const handleDownloadLatestBackup = useCallback(async () => {
    await downloadLatestBackupAction({
      auth,
      featureApi,
      latestBackup,
      onUnauthorized: handleApiError,
      onDownload: triggerBrowserDownload,
      setBackupTaskState,
    });
  }, [auth, featureApi, handleApiError, latestBackup, setBackupTaskState]);

  const handleChangePassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await changePasswordAction({
        auth,
        featureApi,
        passwordForm: passwordState.form,
        clearSession,
        setPasswordState,
      });
    },
    [auth, clearSession, featureApi, passwordState.form, setPasswordState],
  );

  const handleSaveOperation = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await saveOperationAction({
        auth,
        featureApi,
        operationForm,
        onUnauthorized: handleApiError,
        onSaved: loadDashboard,
        onReset: resetOperations,
      });
    },
    [auth, featureApi, handleApiError, loadDashboard, operationForm, resetOperations],
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
      setCategoryMessage(null);
      await runDashboardMutation({
        auth,
        execute: (token) =>
          featureApi.categories.save(token, {
            id: categoryForm.id,
            name: categoryForm.name.trim(),
            type: categoryForm.type,
            isActive: categoryForm.isActive,
            parentId: categoryForm.kind === 'leaf' ? categoryForm.parentId : null,
          }),
        onUnauthorized: handleCategoryApiError,
        fallbackMessage: 'Не удалось сохранить категорию',
        onError: setCategoryMessage,
        onSuccess: async () => {
          resetCategories();
          await loadDashboard();
        },
      });
    },
    [auth, categoryForm, featureApi.categories, handleCategoryApiError, loadDashboard, resetCategories, setCategoryMessage],
  );

  const handleDeactivateCategory = useCallback(
    async (id: string) => {
      setCategoryMessage(null);
      await runDashboardMutation({
        auth,
        execute: (token) => featureApi.categories.deactivate(token, id),
        onUnauthorized: handleCategoryApiError,
        fallbackMessage: 'Не удалось отключить категорию',
        onError: setCategoryMessage,
        onSuccess: loadDashboard,
      });
    },
    [auth, featureApi.categories, handleCategoryApiError, loadDashboard, setCategoryMessage],
  );

  const handleRestoreCategory = useCallback(
    async (id: string) => {
      setCategoryMessage(null);
      await runDashboardMutation({
        auth,
        execute: (token) => featureApi.categories.restore(token, id),
        onUnauthorized: handleCategoryApiError,
        fallbackMessage: 'Не удалось включить категорию',
        onError: setCategoryMessage,
        onSuccess: loadDashboard,
      });
    },
    [auth, featureApi.categories, handleCategoryApiError, loadDashboard, setCategoryMessage],
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
