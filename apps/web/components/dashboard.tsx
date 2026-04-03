'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { UnauthorizedError } from '../lib/api';
import { getWebAppConfig } from '../lib/config';
import { type Section, type Settings } from '../lib/types';
import { useAuthSession } from '../hooks/use-auth-session';
import { useCategoriesSection } from '../hooks/use-categories-section';
import { useDashboardData } from '../hooks/use-dashboard-data';
import { useLogsSection } from '../hooks/use-logs-section';
import { useOperationsSection } from '../hooks/use-operations-section';
import { useSettingsSection } from '../hooks/use-settings-section';
import { LoginView } from './dashboard/login-view';
import { CategoryModal, OperationModal } from './dashboard/modals';
import {
  CategoriesSection,
  DashboardLayout,
  LogsSection,
  OperationsSection,
  OverviewSection,
  SettingsSection,
  UsersSection,
} from './dashboard/sections';

export function Dashboard() {
  const { apiUrl } = getWebAppConfig();
  const { auth, saveAuth, clearAuth } = useAuthSession();
  const {
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
    loading,
    error,
    setError,
    logsError,
    setLogsError,
    logsLoading,
    resetData,
    reloadData,
    reloadLogs,
  } = useDashboardData(apiUrl);
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
    } catch (loadError) {
      handleApiError(loadError, 'Не удалось загрузить данные');
    }
  }, [auth, handleApiError, operations.statusFilter, operations.typeFilter, reloadData]);

  const loadLogs = useCallback(async () => {
    if (!auth || section !== 'logs') {
      return;
    }

    try {
      await reloadLogs(auth.accessToken, logsSection.logLevelFilter, logsSection.logSourceFilter);
    } catch (logsLoadError) {
      if (!handleApiError(logsLoadError, 'Не удалось загрузить логи')) {
        setLogsError(
          logsLoadError instanceof Error
            ? logsLoadError.message
            : 'Не удалось загрузить логи',
        );
      }
    }
  }, [
    auth,
    handleApiError,
    logsSection.logLevelFilter,
    logsSection.logSourceFilter,
    reloadLogs,
    section,
    setLogsError,
  ]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
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
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : 'Не удалось выполнить вход',
      );
    }
  };

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth || !settings) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    settingsSection.setSettingsMessage(null);

    try {
      const nextSettings = await featureApi.settings.save(auth.accessToken, {
        householdName: formData.get('householdName'),
        defaultCurrency: formData.get('defaultCurrency'),
        telegramMode: formData.get('telegramMode'),
        aiModel: formData.get('aiModel'),
        clarificationTimeoutMinutes: Number(
          formData.get('clarificationTimeoutMinutes'),
        ),
        parsingPrompt: formData.get('parsingPrompt'),
        clarificationPrompt: formData.get('clarificationPrompt'),
      });
      setSettings(nextSettings as Settings);
      settingsSection.setSettingsMessage('Настройки сохранены');
    } catch (settingsError) {
      handleApiError(settingsError, 'Не удалось сохранить настройки');
    }
  };

  const handleCreateBackup = async () => {
    if (!auth) {
      return;
    }

    settingsSection.setBackupState((current) => ({
      ...current,
      creating: true,
      error: null,
      message: null,
    }));

    try {
      const backup = await featureApi.settings.createBackup(auth.accessToken);
      setLatestBackup(backup);
      settingsSection.setBackupState((current) => ({
        ...current,
        message: `Бэкап ${backup.fileName} создан`,
      }));
    } catch (backupCreateError) {
      if (!handleApiError(backupCreateError, 'Не удалось создать бэкап')) {
        settingsSection.setBackupState((current) => ({
          ...current,
          error:
            backupCreateError instanceof Error
              ? backupCreateError.message
              : 'Не удалось создать бэкап',
        }));
      }
    } finally {
      settingsSection.setBackupState((current) => ({ ...current, creating: false }));
    }
  };

  const handleDownloadLatestBackup = async () => {
    if (!auth) {
      return;
    }

    settingsSection.setBackupState((current) => ({
      ...current,
      downloading: true,
      error: null,
      message: null,
    }));

    try {
      const { blob, fileName } = await featureApi.settings.downloadLatestBackup(auth.accessToken);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName ?? latestBackup?.fileName ?? 'denga-backup.dump';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      settingsSection.setBackupState((current) => ({
        ...current,
        message: `Бэкап ${link.download} скачан`,
      }));
    } catch (backupDownloadError) {
      if (!handleApiError(backupDownloadError, 'Не удалось скачать бэкап')) {
        settingsSection.setBackupState((current) => ({
          ...current,
          error:
            backupDownloadError instanceof Error
              ? backupDownloadError.message
              : 'Не удалось скачать бэкап',
        }));
      }
    } finally {
      settingsSection.setBackupState((current) => ({ ...current, downloading: false }));
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    settingsSection.setPasswordState((current) => ({
      ...current,
      error: null,
      success: null,
    }));

    if (
      settingsSection.passwordState.form.newPassword !==
      settingsSection.passwordState.form.confirmPassword
    ) {
      settingsSection.setPasswordState((current) => ({
        ...current,
        error: 'Новый пароль и подтверждение не совпадают',
      }));
      return;
    }

    try {
      await featureApi.settings.changePassword(auth.accessToken, {
        currentPassword: settingsSection.passwordState.form.currentPassword,
        newPassword: settingsSection.passwordState.form.newPassword,
      });
      settingsSection.setPasswordState({
        form: {
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        },
        error: null,
        success: 'Пароль обновлен',
      });
    } catch (passwordChangeError) {
      if (passwordChangeError instanceof UnauthorizedError) {
        clearSession(passwordChangeError.message);
        return;
      }

      settingsSection.setPasswordState((current) => ({
        ...current,
        error:
          passwordChangeError instanceof Error
            ? passwordChangeError.message
            : 'Не удалось обновить пароль',
      }));
    }
  };

  const handleSaveOperation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    try {
      await featureApi.operations.save(auth.accessToken, {
        id: operations.operationForm.id,
        type: operations.operationForm.type,
        amount: Number(operations.operationForm.amount),
        occurredAt: new Date(operations.operationForm.occurredAt).toISOString(),
        categoryId: operations.operationForm.categoryId,
        comment: operations.operationForm.comment,
        status: operations.operationForm.status,
      });
    } catch (operationError) {
      handleApiError(operationError, 'Не удалось сохранить операцию');
      return;
    }

    operations.reset();
    await loadDashboard();
  };

  const handleCancelOperation = async (id: string) => {
    if (!auth) {
      return;
    }

    try {
      await featureApi.operations.cancel(auth.accessToken, id);
    } catch (operationError) {
      handleApiError(operationError, 'Не удалось отменить операцию');
      return;
    }

    await loadDashboard();
  };

  const handleSaveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    try {
      await featureApi.categories.save(auth.accessToken, {
        id: categorySection.categoryForm.id,
        name: categorySection.categoryForm.name.trim(),
        type: categorySection.categoryForm.type,
        isActive: categorySection.categoryForm.isActive,
      });
    } catch (categoryError) {
      handleApiError(categoryError, 'Не удалось сохранить категорию');
      return;
    }

    categorySection.reset();
    await loadDashboard();
  };

  const handleDeactivateCategory = async (id: string) => {
    if (!auth) {
      return;
    }

    try {
      await featureApi.categories.deactivate(auth.accessToken, id);
    } catch (categoryError) {
      handleApiError(categoryError, 'Не удалось отключить категорию');
      return;
    }

    await loadDashboard();
  };

  const handleRestoreCategory = async (id: string) => {
    if (!auth) {
      return;
    }

    try {
      await featureApi.categories.restore(auth.accessToken, id);
    } catch (categoryError) {
      handleApiError(categoryError, 'Не удалось включить категорию');
      return;
    }

    await loadDashboard();
  };

  if (!apiUrl) {
    return (
      <div className="login-shell">
        <div className="panel login-card">
          <h1>Панель Denga</h1>
          <p className="error">
            `NEXT_PUBLIC_API_URL` не задан. Добавьте переменную окружения перед запуском web
            приложения.
          </p>
        </div>
      </div>
    );
  }

  if (!auth) {
    return <LoginView error={error} onSubmit={handleLogin} />;
  }

  return (
    <>
      <DashboardLayout
        auth={auth}
        section={section}
        settings={settings}
        loading={loading}
        error={error}
        onSectionChange={setSection}
      >
        {section === 'overview' && summary ? <OverviewSection summary={summary} /> : null}
        {section === 'operations' ? (
          <OperationsSection
            transactions={transactions}
            statusFilter={operations.statusFilter}
            typeFilter={operations.typeFilter}
            onStatusFilterChange={operations.setStatusFilter}
            onTypeFilterChange={operations.setTypeFilter}
            onCreate={operations.openCreateOperationModal}
            onEdit={operations.openEditOperationModal}
            onCancel={(id) => void handleCancelOperation(id)}
          />
        ) : null}
        {section === 'categories' ? (
          <CategoriesSection
            categories={categorySection.visibleCategories}
            statusFilter={categorySection.categoryStatusFilter}
            typeFilter={categorySection.categoryTypeFilter}
            onStatusFilterChange={categorySection.setCategoryStatusFilter}
            onTypeFilterChange={categorySection.setCategoryTypeFilter}
            onCreate={categorySection.openCreateCategoryModal}
            onEdit={categorySection.openEditCategoryModal}
            onDeactivate={(id) => void handleDeactivateCategory(id)}
            onRestore={(id) => void handleRestoreCategory(id)}
          />
        ) : null}
        {section === 'users' ? <UsersSection users={users} /> : null}
        {section === 'logs' ? (
          <LogsSection
            logs={logs}
            logsLoading={logsLoading}
            logsError={logsError}
            logSources={logsSection.logSources}
            logLevelFilter={logsSection.logLevelFilter}
            logSourceFilter={logsSection.logSourceFilter}
            onLogLevelChange={logsSection.setLogLevelFilter}
            onLogSourceChange={logsSection.setLogSourceFilter}
            onRefresh={() => void loadLogs()}
          />
        ) : null}
        {section === 'settings' && settings ? (
          <SettingsSection
            settings={settings}
            latestBackup={latestBackup}
            backupMessage={settingsSection.backupState.message}
            backupError={settingsSection.backupState.error}
            backupCreating={settingsSection.backupState.creating}
            backupDownloading={settingsSection.backupState.downloading}
            settingsMessage={settingsSection.settingsMessage}
            passwordForm={settingsSection.passwordState.form}
            passwordError={settingsSection.passwordState.error}
            passwordSuccess={settingsSection.passwordState.success}
            onCreateBackup={handleCreateBackup}
            onDownloadLatestBackup={handleDownloadLatestBackup}
            onSaveSettings={handleSaveSettings}
            onChangePassword={handleChangePassword}
            onPasswordFormChange={(updater) =>
              settingsSection.setPasswordState((current) => ({
                ...current,
                form: updater(current.form),
              }))
            }
          />
        ) : null}
      </DashboardLayout>

      <OperationModal
        isOpen={operations.isOperationModalOpen}
        form={operations.operationForm}
        filteredCategories={operations.filteredCategories}
        onClose={() => operations.setOperationModalOpen(false)}
        onSubmit={handleSaveOperation}
        onChange={(updater) => operations.setOperationForm(updater)}
      />
      <CategoryModal
        isOpen={categorySection.isCategoryModalOpen}
        form={categorySection.categoryForm}
        onClose={() => categorySection.setCategoryModalOpen(false)}
        onSubmit={handleSaveCategory}
        onChange={(updater) => categorySection.setCategoryForm(updater)}
      />
    </>
  );
}
