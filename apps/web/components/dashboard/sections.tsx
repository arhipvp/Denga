'use client';

import { format } from 'date-fns';
import type { FormEvent, ReactNode } from 'react';
import {
  formatCategoryStatusLabel,
  formatTransactionStatusLabel,
  formatTransactionTypeLabel,
  sectionLabels,
} from '../../lib/dashboard';
import type {
  AuthState,
  Category,
  LogEntry,
  PasswordFormState,
  Section,
  Settings,
  Summary,
  Transaction,
  User,
} from '../../lib/types';

type LayoutProps = {
  auth: AuthState;
  section: Section;
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  onSectionChange: (section: Section) => void;
  children: ReactNode;
};

export function DashboardLayout({
  auth,
  section,
  settings,
  loading,
  error,
  onSectionChange,
  children,
}: LayoutProps) {
  return (
    <div className="page-shell">
      <div className="layout">
        <aside className="panel sidebar">
          <span className="badge">Администратор</span>
          <h1>Denga</h1>
          <p>Семейный журнал доходов и расходов с приемом сообщений через Telegram.</p>
          <div className="nav">
            {(Object.keys(sectionLabels) as Section[]).map((item) => (
              <button
                key={item}
                className={section === item ? 'active' : ''}
                onClick={() => onSectionChange(item)}
                type="button"
              >
                {sectionLabels[item]}
              </button>
            ))}
          </div>
        </aside>

        <main className="content">
          <section className="panel toolbar hero">
            <div>
              <h2>{settings?.householdName ?? 'Загрузка...'}</h2>
              <p>{auth.user.email}</p>
            </div>
            <div className="actions">
              <span className="badge">{settings?.defaultCurrency ?? 'EUR'}</span>
              <span className="badge warn">
                Telegram: {settings?.telegramMode === 'webhook' ? 'вебхук' : 'опрос'}
              </span>
            </div>
          </section>

          {loading ? <section className="panel card">Загрузка...</section> : null}
          {error ? <section className="panel card error">{error}</section> : null}

          {children}
        </main>
      </div>
    </div>
  );
}

export function OverviewSection({ summary }: { summary: Summary }) {
  return (
    <>
      <section className="grid">
        <article className="panel stat">
          <span>Доходы</span>
          <strong>{summary.totals.income.toFixed(2)}</strong>
        </article>
        <article className="panel stat">
          <span>Расходы</span>
          <strong>{summary.totals.expense.toFixed(2)}</strong>
        </article>
        <article className="panel stat">
          <span>Баланс</span>
          <strong>{summary.totals.balance.toFixed(2)}</strong>
        </article>
        <article className="panel stat">
          <span>Отмененные</span>
          <strong>{summary.totals.cancelledCount}</strong>
        </article>
      </section>

      <section className="panel card">
        <h3>Месячный тренд</h3>
        <div className="grid">
          {summary.monthly.map((item) => {
            const scale = Math.max(item.income, item.expense, Math.abs(item.net), 1);
            return (
              <article key={item.month} className="stat">
                <span>{item.month}</span>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div>
                    <div>Доходы: {item.income.toFixed(2)}</div>
                    <div
                      style={{
                        height: 10,
                        width: `${(item.income / scale) * 100}%`,
                        background: 'var(--accent)',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <div>
                    <div>Расходы: {item.expense.toFixed(2)}</div>
                    <div
                      style={{
                        height: 10,
                        width: `${(item.expense / scale) * 100}%`,
                        background: 'var(--danger)',
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  <div>Баланс: {item.net.toFixed(2)}</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel card">
        <h3>Последние операции</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Тип</th>
              <th>Сумма</th>
              <th>Категория</th>
            </tr>
          </thead>
          <tbody>
            {summary.recent.map((item) => (
              <tr key={item.id}>
                <td>{format(new Date(item.occurredAt), 'dd.MM.yyyy')}</td>
                <td>{formatTransactionTypeLabel(item.type)}</td>
                <td>
                  {item.amount} {item.currency}
                </td>
                <td>{item.category?.name ?? 'Не определена'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

type OperationsSectionProps = {
  transactions: Transaction[];
  statusFilter: 'all' | 'confirmed' | 'cancelled';
  typeFilter: 'all' | 'income' | 'expense';
  onStatusFilterChange: (value: 'all' | 'confirmed' | 'cancelled') => void;
  onTypeFilterChange: (value: 'all' | 'income' | 'expense') => void;
  onCreate: () => void;
  onEdit: (transaction: Transaction) => void;
  onCancel: (id: string) => void;
};

export function OperationsSection({
  transactions,
  statusFilter,
  typeFilter,
  onStatusFilterChange,
  onTypeFilterChange,
  onCreate,
  onEdit,
  onCancel,
}: OperationsSectionProps) {
  return (
    <section className="panel card">
      <div className="hero" style={{ marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0 }}>Операции</h3>
          <p style={{ margin: '8px 0 0' }}>Ручное управление операциями.</p>
        </div>
        <div className="actions">
          <select
            value={statusFilter}
            onChange={(event) =>
              onStatusFilterChange(event.target.value as typeof statusFilter)
            }
          >
            <option value="confirmed">подтвержденные</option>
            <option value="cancelled">отмененные</option>
            <option value="all">все</option>
          </select>
          <select
            value={typeFilter}
            onChange={(event) =>
              onTypeFilterChange(event.target.value as typeof typeFilter)
            }
          >
            <option value="all">все типы</option>
            <option value="income">доходы</option>
            <option value="expense">расходы</option>
          </select>
          <button className="button" type="button" onClick={onCreate}>
            Добавить операцию
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Тип</th>
            <th>Сумма</th>
            <th>Категория</th>
            <th>Примечание</th>
            <th>Автор</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((item) => (
            <tr key={item.id}>
              <td>{format(new Date(item.occurredAt), 'dd.MM.yyyy')}</td>
              <td>{formatTransactionTypeLabel(item.type)}</td>
              <td>
                {item.amount} {item.currency}
              </td>
              <td>{item.category?.name ?? 'Не определена'}</td>
              <td>{item.comment?.trim() ? item.comment : '—'}</td>
              <td>{item.author?.displayName ?? 'Система'}</td>
              <td>
                <span
                  className={
                    item.status === 'CONFIRMED'
                      ? 'badge'
                      : item.status === 'NEEDS_CLARIFICATION'
                        ? 'badge warn'
                        : 'badge danger'
                  }
                >
                  {formatTransactionStatusLabel(item.status)}
                </span>
              </td>
              <td>
                <div className="actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onEdit(item)}
                  >
                    Редактировать
                  </button>
                  {item.status !== 'CANCELLED' ? (
                    <button
                      className="button danger"
                      type="button"
                      onClick={() => onCancel(item.id)}
                    >
                      Отменить
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type CategoriesSectionProps = {
  categories: Category[];
  statusFilter: 'active' | 'inactive' | 'all';
  typeFilter: 'all' | 'income' | 'expense';
  onStatusFilterChange: (value: 'active' | 'inactive' | 'all') => void;
  onTypeFilterChange: (value: 'all' | 'income' | 'expense') => void;
  onCreate: () => void;
  onEdit: (category: Category) => void;
  onDeactivate: (id: string) => void;
  onRestore: (id: string) => void;
};

export function CategoriesSection({
  categories,
  statusFilter,
  typeFilter,
  onStatusFilterChange,
  onTypeFilterChange,
  onCreate,
  onEdit,
  onDeactivate,
  onRestore,
}: CategoriesSectionProps) {
  return (
    <section className="panel card">
      <div className="hero" style={{ marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0 }}>Категории</h3>
          <p style={{ margin: '8px 0 0' }}>
            Управление справочником категорий для доходов и расходов.
          </p>
        </div>
        <div className="actions">
          <select
            value={statusFilter}
            onChange={(event) =>
              onStatusFilterChange(event.target.value as typeof statusFilter)
            }
          >
            <option value="active">активные</option>
            <option value="inactive">отключенные</option>
            <option value="all">все</option>
          </select>
          <select
            value={typeFilter}
            onChange={(event) =>
              onTypeFilterChange(event.target.value as typeof typeFilter)
            }
          >
            <option value="all">все типы</option>
            <option value="expense">расходы</option>
            <option value="income">доходы</option>
          </select>
          <button className="button" type="button" onClick={onCreate}>
            Добавить категорию
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{formatTransactionTypeLabel(item.type)}</td>
              <td>
                <span className={item.isActive ? 'badge' : 'badge danger'}>
                  {formatCategoryStatusLabel(item.isActive)}
                </span>
              </td>
              <td>
                <div className="actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onEdit(item)}
                  >
                    Редактировать
                  </button>
                  {item.isActive ? (
                    <button
                      className="button danger"
                      type="button"
                      onClick={() => onDeactivate(item.id)}
                    >
                      Отключить
                    </button>
                  ) : (
                    <button
                      className="button"
                      type="button"
                      onClick={() => onRestore(item.id)}
                    >
                      Включить
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function UsersSection({ users }: { users: User[] }) {
  return (
    <section className="panel card">
      <h3>Пользователи</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Email</th>
            <th>Telegram</th>
          </tr>
        </thead>
        <tbody>
          {users.map((item) => (
            <tr key={item.id}>
              <td>{item.displayName}</td>
              <td>{item.email ?? 'Только Telegram'}</td>
              <td>
                {item.telegramAccounts.length > 0
                  ? item.telegramAccounts
                      .map((account) => account.username ?? account.telegramId)
                      .join(', ')
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type LogsSectionProps = {
  logs: LogEntry[];
  logsLoading: boolean;
  logsError: string | null;
  logSources: string[];
  logLevelFilter: 'all' | LogEntry['level'];
  logSourceFilter: string;
  onLogLevelChange: (value: 'all' | LogEntry['level']) => void;
  onLogSourceChange: (value: string) => void;
  onRefresh: () => void;
};

export function LogsSection({
  logs,
  logsLoading,
  logsError,
  logSources,
  logLevelFilter,
  logSourceFilter,
  onLogLevelChange,
  onLogSourceChange,
  onRefresh,
}: LogsSectionProps) {
  return (
    <section className="panel card">
      <div className="hero" style={{ marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0 }}>Системные логи</h3>
          <p style={{ margin: '8px 0 0' }}>
            Последние события backend и системные ошибки.
          </p>
        </div>
        <div className="actions">
          <select
            value={logLevelFilter}
            onChange={(event) =>
              onLogLevelChange(event.target.value as typeof logLevelFilter)
            }
          >
            <option value="all">все уровни</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="debug">debug</option>
          </select>
          <select
            value={logSourceFilter}
            onChange={(event) => onLogSourceChange(event.target.value)}
          >
            <option value="all">все источники</option>
            {logSources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <button className="button secondary" type="button" onClick={onRefresh}>
            Обновить
          </button>
        </div>
      </div>

      {logsLoading ? <p style={{ margin: 0 }}>Загрузка логов...</p> : null}
      {logsError ? <p className="error">{logsError}</p> : null}
      {!logsLoading && !logsError && logs.length === 0 ? (
        <p style={{ margin: 0 }}>Записей пока нет.</p>
      ) : null}

      {logs.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Уровень</th>
              <th>Источник</th>
              <th>Событие</th>
              <th>Сообщение</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((item, index) => (
              <tr key={`${item.timestamp}-${item.event}-${index}`}>
                <td>{format(new Date(item.timestamp), 'dd.MM.yyyy HH:mm:ss')}</td>
                <td>
                  <span
                    className={
                      item.level === 'error'
                        ? 'badge danger'
                        : item.level === 'warn'
                          ? 'badge warn'
                          : 'badge'
                    }
                  >
                    {item.level}
                  </span>
                </td>
                <td>{item.source}</td>
                <td>{item.event}</td>
                <td>{item.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

type SettingsSectionProps = {
  settings: Settings;
  settingsMessage: string | null;
  passwordForm: PasswordFormState;
  passwordError: string | null;
  passwordSuccess: string | null;
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChangePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPasswordFormChange: (
    updater: (current: PasswordFormState) => PasswordFormState,
  ) => void;
};

export function SettingsSection({
  settings,
  settingsMessage,
  passwordForm,
  passwordError,
  passwordSuccess,
  onSaveSettings,
  onChangePassword,
  onPasswordFormChange,
}: SettingsSectionProps) {
  return (
    <section className="panel card">
      <h3>Настройки</h3>
      <form className="form-grid" onSubmit={onSaveSettings}>
        <div className="field">
          <label htmlFor="householdName">Название семьи</label>
          <input defaultValue={settings.householdName} id="householdName" name="householdName" required />
        </div>
        <div className="field">
          <label htmlFor="defaultCurrency">Базовая валюта</label>
          <input defaultValue="EUR" id="defaultCurrency" maxLength={3} name="defaultCurrency" readOnly required />
          <small>Все новые операции в системе сохраняются только в евро.</small>
        </div>
        <div className="field">
          <label htmlFor="telegramMode">Режим Telegram</label>
          <select defaultValue={settings.telegramMode} id="telegramMode" name="telegramMode">
            <option value="polling">опрос</option>
            <option value="webhook">вебхук</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="aiModel">AI-модель</label>
          <input defaultValue={settings.aiModel} id="aiModel" name="aiModel" required />
        </div>
        <div className="field">
          <label htmlFor="clarificationTimeoutMinutes">Таймаут уточнения</label>
          <input defaultValue={settings.clarificationTimeoutMinutes} id="clarificationTimeoutMinutes" name="clarificationTimeoutMinutes" type="number" />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="parsingPrompt">Промпт разбора</label>
          <textarea defaultValue={settings.parsingPrompt} id="parsingPrompt" name="parsingPrompt" />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="clarificationPrompt">Промпт уточнения</label>
          <textarea defaultValue={settings.clarificationPrompt} id="clarificationPrompt" name="clarificationPrompt" />
        </div>
        <div className="actions" style={{ gridColumn: '1 / -1' }}>
          <button className="button" type="submit">
            Сохранить настройки
          </button>
        </div>
        {settingsMessage ? (
          <p style={{ gridColumn: '1 / -1', margin: 0 }}>{settingsMessage}</p>
        ) : null}
      </form>

      <div
        style={{
          marginTop: 32,
          paddingTop: 24,
          borderTop: '1px solid rgba(148, 163, 184, 0.24)',
        }}
      >
        <h3>Сменить пароль администратора</h3>
        <form className="form-grid" onSubmit={onChangePassword}>
          <div className="field">
            <label htmlFor="currentPassword">Текущий пароль</label>
            <input
              id="currentPassword"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({
                  ...current,
                  currentPassword: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newPassword">Новый пароль</label>
            <input
              id="newPassword"
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({
                  ...current,
                  newPassword: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Подтверждение нового пароля</label>
            <input
              id="confirmPassword"
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                onPasswordFormChange((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
              required
            />
          </div>
          {passwordError ? (
            <p className="error" style={{ gridColumn: '1 / -1', margin: 0 }}>
              {passwordError}
            </p>
          ) : null}
          {passwordSuccess ? (
            <p style={{ gridColumn: '1 / -1', margin: 0 }}>{passwordSuccess}</p>
          ) : null}
          <div className="actions" style={{ gridColumn: '1 / -1' }}>
            <button className="button" type="submit">
              Обновить пароль
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
