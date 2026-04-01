'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { UnauthorizedError } from '../lib/api';
import { getWebAppConfig } from '../lib/config';
import {
  type BackupInfo,
  emptyCategoryForm,
  emptyOperationForm,
  emptyPasswordForm,
  type AuthState,
  type Category,
  type LogEntry,
  type Section,
  type Settings,
  type Transaction,
} from '../lib/types';
import { useAuthSession } from '../hooks/use-auth-session';
import { useDashboardData } from '../hooks/use-dashboard-data';
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
    apiClient,
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'cancelled'>(
    'confirmed',
  );
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [isOperationModalOpen, setOperationModalOpen] = useState(false);
  const [operationForm, setOperationForm] = useState(emptyOperationForm);
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<
    'active' | 'inactive' | 'all'
  >('active');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<
    'all' | 'income' | 'expense'
  >('all');
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [backupState, setBackupState] = useState({
    message: null as string | null,
    error: null as string | null,
    creating: false,
    downloading: false,
  });
  const [passwordState, setPasswordState] = useState({
    form: emptyPasswordForm,
    error: null as string | null,
    success: null as string | null,
  });
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | LogEntry['level']>('all');
  const [logSourceFilter, setLogSourceFilter] = useState('all');

  const resetDashboardUi = useCallback(() => {
    setSettingsMessage(null);
    setBackupState({
      message: null,
      error: null,
      creating: false,
      downloading: false,
    });
    setPasswordState({
      form: emptyPasswordForm,
      error: null,
      success: null,
    });
    setOperationModalOpen(false);
    setCategoryModalOpen(false);
    setOperationForm(emptyOperationForm);
    setCategoryForm(emptyCategoryForm);
  }, []);

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

  const filteredCategories = useMemo(
    () =>
      categories.filter(
        (item) =>
          item.isActive &&
          item.type === (operationForm.type === 'income' ? 'INCOME' : 'EXPENSE'),
      ),
    [categories, operationForm.type],
  );

  const visibleCategories = useMemo(() => {
    return categories.filter((item) => {
      const matchesStatus =
        categoryStatusFilter === 'all' ||
        (categoryStatusFilter === 'active' ? item.isActive : !item.isActive);
      const matchesType =
        categoryTypeFilter === 'all' ||
        item.type === (categoryTypeFilter === 'income' ? 'INCOME' : 'EXPENSE');

      return matchesStatus && matchesType;
    });
  }, [categories, categoryStatusFilter, categoryTypeFilter]);

  const logSources = useMemo(() => {
    return Array.from(new Set(logs.map((item) => item.source))).sort();
  }, [logs]);

  const loadDashboard = useCallback(async () => {
    if (!auth) {
      return;
    }

    try {
      await reloadData(auth.accessToken, statusFilter, typeFilter);
    } catch (loadError) {
      handleApiError(loadError, 'Не удалось загрузить данные');
    }
  }, [auth, handleApiError, reloadData, statusFilter, typeFilter]);

  const loadLogs = useCallback(async () => {
    if (!auth || section !== 'logs') {
      return;
    }

    try {
      await reloadLogs(auth.accessToken, logLevelFilter, logSourceFilter);
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
    logLevelFilter,
    logSourceFilter,
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
      const payload = (await apiClient.login(
        formData.get('email'),
        formData.get('password'),
      )) as AuthState;
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
    setSettingsMessage(null);

    try {
      const nextSettings = await apiClient.request<Settings>('/settings', auth.accessToken, {
        method: 'PUT',
        body: JSON.stringify({
          householdName: formData.get('householdName'),
          defaultCurrency: formData.get('defaultCurrency'),
          telegramMode: formData.get('telegramMode'),
          aiModel: formData.get('aiModel'),
          clarificationTimeoutMinutes: Number(
            formData.get('clarificationTimeoutMinutes'),
          ),
          parsingPrompt: formData.get('parsingPrompt'),
          clarificationPrompt: formData.get('clarificationPrompt'),
        }),
      });
      setSettings(nextSettings);
      setSettingsMessage('Настройки сохранены');
    } catch (settingsError) {
      handleApiError(settingsError, 'Не удалось сохранить настройки');
    }
  };

  const handleCreateBackup = async () => {
    if (!auth) {
      return;
    }

    setBackupState((current) => ({
      ...current,
      creating: true,
      error: null,
      message: null,
    }));

    try {
      const backup = await apiClient.request<BackupInfo>('/backups', auth.accessToken, {
        method: 'POST',
      });
      setLatestBackup(backup);
      setBackupState((current) => ({
        ...current,
        message: `Бэкап ${backup.fileName} создан`,
      }));
    } catch (backupCreateError) {
      if (!handleApiError(backupCreateError, 'Не удалось создать бэкап')) {
        setBackupState((current) => ({
          ...current,
          error:
            backupCreateError instanceof Error
              ? backupCreateError.message
              : 'Не удалось создать бэкап',
        }));
      }
    } finally {
      setBackupState((current) => ({ ...current, creating: false }));
    }
  };

  const handleDownloadLatestBackup = async () => {
    if (!auth) {
      return;
    }

    setBackupState((current) => ({
      ...current,
      downloading: true,
      error: null,
      message: null,
    }));

    try {
      const { blob, fileName } = await apiClient.download(
        '/backups/latest/download',
        auth.accessToken,
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName ?? latestBackup?.fileName ?? 'denga-backup.dump';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setBackupState((current) => ({
        ...current,
        message: `Бэкап ${link.download} скачан`,
      }));
    } catch (backupDownloadError) {
      if (!handleApiError(backupDownloadError, 'Не удалось скачать бэкап')) {
        setBackupState((current) => ({
          ...current,
          error:
            backupDownloadError instanceof Error
              ? backupDownloadError.message
              : 'Не удалось скачать бэкап',
        }));
      }
    } finally {
      setBackupState((current) => ({ ...current, downloading: false }));
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    setPasswordState((current) => ({
      ...current,
      error: null,
      success: null,
    }));

    if (passwordState.form.newPassword !== passwordState.form.confirmPassword) {
      setPasswordState((current) => ({
        ...current,
        error: 'Новый пароль и подтверждение не совпадают',
      }));
      return;
    }

    try {
      await apiClient.request<{ success: true }>('/auth/change-password', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordState.form.currentPassword,
          newPassword: passwordState.form.newPassword,
        }),
      });
      setPasswordState({
        form: emptyPasswordForm,
        error: null,
        success: 'Пароль обновлен',
      });
    } catch (passwordChangeError) {
      if (passwordChangeError instanceof UnauthorizedError) {
        clearSession(passwordChangeError.message);
        return;
      }

      setPasswordState((current) => ({
        ...current,
        error:
          passwordChangeError instanceof Error
            ? passwordChangeError.message
            : 'Не удалось обновить пароль',
      }));
    }
  };

  const openCreateOperationModal = () => {
    setOperationForm({
      ...emptyOperationForm,
      categoryId: categories.find((item) => item.type === 'EXPENSE')?.id ?? '',
    });
    setOperationModalOpen(true);
  };

  const openCreateCategoryModal = () => {
    setCategoryForm(emptyCategoryForm);
    setCategoryModalOpen(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setCategoryForm({
      id: category.id,
      name: category.name,
      type: category.type === 'INCOME' ? 'income' : 'expense',
      isActive: category.isActive,
    });
    setCategoryModalOpen(true);
  };

  const openEditOperationModal = (transaction: Transaction) => {
    setOperationForm({
      id: transaction.id,
      type: transaction.type === 'INCOME' ? 'income' : 'expense',
      amount: transaction.amount,
      occurredAt: transaction.occurredAt.slice(0, 10),
      categoryId: transaction.category?.id ?? '',
      comment: transaction.comment ?? '',
      status: transaction.status === 'CANCELLED' ? 'cancelled' : 'confirmed',
    });
    setOperationModalOpen(true);
  };

  const handleSaveOperation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    const payload = {
      type: operationForm.type,
      amount: Number(operationForm.amount),
      occurredAt: new Date(operationForm.occurredAt).toISOString(),
      categoryId: operationForm.categoryId,
      comment: operationForm.comment,
      status: operationForm.status,
    };

    try {
      await apiClient.request<unknown>(
        operationForm.id ? `/transactions/${operationForm.id}` : '/transactions',
        auth.accessToken,
        {
          method: operationForm.id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
    } catch (operationError) {
      handleApiError(operationError, 'Не удалось сохранить операцию');
      return;
    }

    setOperationModalOpen(false);
    setOperationForm(emptyOperationForm);
    await loadDashboard();
  };

  const handleCancelOperation = async (id: string) => {
    if (!auth) {
      return;
    }

    try {
      await apiClient.request<unknown>(`/transactions/${id}`, auth.accessToken, {
        method: 'DELETE',
      });
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

    const payload = {
      name: categoryForm.name.trim(),
      type: categoryForm.type,
      isActive: categoryForm.isActive,
    };

    try {
      await apiClient.request<unknown>(
        categoryForm.id ? `/categories/${categoryForm.id}` : '/categories',
        auth.accessToken,
        {
          method: categoryForm.id ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
    } catch (categoryError) {
      handleApiError(categoryError, 'Не удалось сохранить категорию');
      return;
    }

    setCategoryModalOpen(false);
    setCategoryForm(emptyCategoryForm);
    await loadDashboard();
  };

  const handleDeactivateCategory = async (id: string) => {
    if (!auth) {
      return;
    }

    try {
      await apiClient.request<unknown>(`/categories/${id}`, auth.accessToken, {
        method: 'DELETE',
      });
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
      await apiClient.request<unknown>(`/categories/${id}`, auth.accessToken, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true }),
      });
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
            statusFilter={statusFilter}
            typeFilter={typeFilter}
            onStatusFilterChange={setStatusFilter}
            onTypeFilterChange={setTypeFilter}
            onCreate={openCreateOperationModal}
            onEdit={openEditOperationModal}
            onCancel={(id) => void handleCancelOperation(id)}
          />
        ) : null}
        {section === 'categories' ? (
          <CategoriesSection
            categories={visibleCategories}
            statusFilter={categoryStatusFilter}
            typeFilter={categoryTypeFilter}
            onStatusFilterChange={setCategoryStatusFilter}
            onTypeFilterChange={setCategoryTypeFilter}
            onCreate={openCreateCategoryModal}
            onEdit={openEditCategoryModal}
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
            logSources={logSources}
            logLevelFilter={logLevelFilter}
            logSourceFilter={logSourceFilter}
            onLogLevelChange={setLogLevelFilter}
            onLogSourceChange={setLogSourceFilter}
            onRefresh={() => void loadLogs()}
          />
        ) : null}
        {section === 'settings' && settings ? (
          <SettingsSection
            settings={settings}
            latestBackup={latestBackup}
            backupMessage={backupState.message}
            backupError={backupState.error}
            backupCreating={backupState.creating}
            backupDownloading={backupState.downloading}
            settingsMessage={settingsMessage}
            passwordForm={passwordState.form}
            passwordError={passwordState.error}
            passwordSuccess={passwordState.success}
            onCreateBackup={handleCreateBackup}
            onDownloadLatestBackup={handleDownloadLatestBackup}
            onSaveSettings={handleSaveSettings}
            onChangePassword={handleChangePassword}
            onPasswordFormChange={(updater) =>
              setPasswordState((current) => ({
                ...current,
                form: updater(current.form),
              }))
            }
          />
        ) : null}
      </DashboardLayout>

      <OperationModal
        isOpen={isOperationModalOpen}
        form={operationForm}
        filteredCategories={filteredCategories}
        onClose={() => setOperationModalOpen(false)}
        onSubmit={handleSaveOperation}
        onChange={(updater) => setOperationForm(updater)}
      />
      <CategoryModal
        isOpen={isCategoryModalOpen}
        form={categoryForm}
        onClose={() => setCategoryModalOpen(false)}
        onSubmit={handleSaveCategory}
        onChange={(updater) => setCategoryForm(updater)}
      />
    </>
  );
}



