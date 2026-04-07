'use client';

import { getWebAppConfig } from '../lib/config';
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
import { useDashboardController } from '../hooks/use-dashboard-controller';

export function Dashboard() {
  const { apiUrl } = getWebAppConfig();
  const controller = useDashboardController(apiUrl);
  const { auth, section, setSection, operations, categorySection, settingsSection, logsSection, data, handlers } =
    controller;

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
    return <LoginView error={data.error} onSubmit={handlers.handleLogin} />;
  }

  return (
    <>
      <DashboardLayout
        auth={auth}
        section={section}
        settings={data.settings}
        loading={data.loading}
        error={data.error}
        onSectionChange={setSection}
      >
        {section === 'overview' && data.summary ? (
          <OverviewSection
            summary={data.summary}
            currency={data.settings?.defaultCurrency ?? 'EUR'}
          />
        ) : null}
        {section === 'operations' ? (
          <OperationsSection
            transactions={data.transactions}
            filters={operations.filters}
            onFiltersChange={(updater) => operations.setFilters(updater)}
            onCreate={operations.openCreateOperationModal}
            onEdit={operations.openEditOperationModal}
            onCancel={(id) => void handlers.handleCancelOperation(id)}
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
            onCreateSubcategory={categorySection.openCreateSubcategoryModal}
            onEdit={categorySection.openEditCategoryModal}
            onDeactivate={(id) => void handlers.handleDeactivateCategory(id)}
            onRestore={(id) => void handlers.handleRestoreCategory(id)}
          />
        ) : null}
        {section === 'users' ? <UsersSection users={data.users} /> : null}
        {section === 'logs' ? (
          <LogsSection
            logs={data.logs}
            logsLoading={data.logsLoading}
            logsError={data.logsError}
            logSources={logsSection.logSources}
            filters={logsSection.filters}
            onFiltersChange={(updater) => logsSection.setFilters(updater)}
            onRefresh={() => void handlers.loadLogs()}
          />
        ) : null}
        {section === 'settings' && data.settings ? (
          <SettingsSection
            settings={data.settings}
            latestBackup={data.latestBackup}
            backupMessage={settingsSection.backupTaskState.message}
            backupError={settingsSection.backupTaskState.error}
            backupCreating={
              settingsSection.backupTaskState.status === 'loading' &&
              settingsSection.backupTaskState.currentAction === 'create'
            }
            backupDownloading={
              settingsSection.backupTaskState.status === 'loading' &&
              settingsSection.backupTaskState.currentAction === 'download'
            }
            settingsMessage={settingsSection.settingsMessage}
            passwordForm={settingsSection.passwordState.form}
            passwordError={settingsSection.passwordState.error}
            passwordSuccess={settingsSection.passwordState.success}
            onCreateBackup={handlers.handleCreateBackup}
            onDownloadLatestBackup={handlers.handleDownloadLatestBackup}
            onSaveSettings={handlers.handleSaveSettings}
            onChangePassword={handlers.handleChangePassword}
            onPasswordFormChange={(updater) =>
              settingsSection.setPasswordState({
                ...settingsSection.passwordState,
                form: updater(settingsSection.passwordState.form),
              })
            }
          />
        ) : null}
      </DashboardLayout>

      <OperationModal
        isOpen={operations.isOperationModalOpen}
        form={operations.operationForm}
        filteredCategories={operations.filteredCategories}
        onClose={() => operations.setOperationModalOpen(false)}
        onSubmit={handlers.handleSaveOperation}
        onChange={(updater) => operations.setOperationForm(updater)}
      />
      <CategoryModal
        isOpen={categorySection.isCategoryModalOpen}
        form={categorySection.categoryForm}
        parentCategories={categorySection.parentCategories}
        onClose={() => categorySection.setCategoryModalOpen(false)}
        onSubmit={handlers.handleSaveCategory}
        onChange={(updater) => categorySection.setCategoryForm(updater)}
      />
    </>
  );
}
