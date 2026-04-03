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
  BackupInfo,
  Category,
  LogEntry,
  PasswordFormState,
  Section,
  Settings,
  Summary,
  Transaction,
  User,
} from '../../lib/types';

function formatBackupSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(value: number) {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDelta(value: number) {
  const formatted = formatMoney(Math.abs(value));
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatted}`;
}

function formatMonthLabel(month: string) {
  const [year, value] = month.split('-').map(Number);
  const labels = [
    'Янв',
    'Фев',
    'Мар',
    'Апр',
    'Май',
    'Июн',
    'Июл',
    'Авг',
    'Сен',
    'Окт',
    'Ноя',
    'Дек',
  ];

  return `${labels[(value ?? 1) - 1]} ${year}`;
}

function formatShare(share: number) {
  return `${(share * 100).toFixed(0)}%`;
}

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
  const monthlyScale = Math.max(
    ...summary.monthly.flatMap((item) => [item.income, item.expense, Math.abs(item.net)]),
    1,
  );

  return (
    <>
      <section className="grid overview-grid">
        <article className="panel stat overview-stat">
          <span>Доходы за месяц</span>
          <strong>{formatMoney(summary.totals.currentPeriod.income)}</strong>
          <small
            className={
              summary.diffs.income > 0
                ? 'delta positive'
                : summary.diffs.income < 0
                  ? 'delta negative'
                  : 'delta'
            }
          >
            К прошлому месяцу: {formatDelta(summary.diffs.income)}
          </small>
        </article>
        <article className="panel stat overview-stat">
          <span>Расходы за месяц</span>
          <strong>{formatMoney(summary.totals.currentPeriod.expense)}</strong>
          <small
            className={
              summary.diffs.expense > 0
                ? 'delta negative'
                : summary.diffs.expense < 0
                  ? 'delta positive'
                  : 'delta'
            }
          >
            К прошлому месяцу: {formatDelta(summary.diffs.expense)}
          </small>
        </article>
        <article className="panel stat overview-stat">
          <span>Баланс</span>
          <strong>{formatMoney(summary.totals.currentPeriod.balance)}</strong>
          <small
            className={
              summary.diffs.balance > 0
                ? 'delta positive'
                : summary.diffs.balance < 0
                  ? 'delta negative'
                  : 'delta'
            }
          >
            К прошлому месяцу: {formatDelta(summary.diffs.balance)}
          </small>
        </article>
        <article className="panel stat overview-stat">
          <span>Подтвержденные операции</span>
          <strong>{summary.counts.operations}</strong>
          <small className="delta neutral">
            Доходов: {summary.counts.income}, расходов: {summary.counts.expense}, отмен: {summary.counts.cancelled}
          </small>
        </article>
      </section>

      <section className="grid overview-secondary-grid">
        <article className="panel card">
          <div className="hero" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>Средние значения</h3>
              <p style={{ margin: '8px 0 0' }}>Текущий календарный месяц.</p>
            </div>
          </div>
          <div className="overview-mini-stats">
            <article className="mini-stat">
              <span>Средний доход</span>
              <strong>{formatMoney(summary.average.income)}</strong>
            </article>
            <article className="mini-stat">
              <span>Средний расход</span>
              <strong>{formatMoney(summary.average.expense)}</strong>
            </article>
            <article className="mini-stat">
              <span>Средняя операция</span>
              <strong>{formatMoney(summary.average.transaction)}</strong>
            </article>
          </div>
        </article>

        <article className="panel card">
          <div className="hero" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>Сравнение периодов</h3>
              <p style={{ margin: '8px 0 0' }}>Текущий месяц против предыдущего.</p>
            </div>
          </div>
          <div className="comparison-list">
            <div className="comparison-row">
              <span>Доходы</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.income)} / {formatMoney(summary.totals.previousPeriod.income)}
              </strong>
            </div>
            <div className="comparison-row">
              <span>Расходы</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.expense)} / {formatMoney(summary.totals.previousPeriod.expense)}
              </strong>
            </div>
            <div className="comparison-row">
              <span>Баланс</span>
              <strong>
                {formatMoney(summary.totals.currentPeriod.balance)} / {formatMoney(summary.totals.previousPeriod.balance)}
              </strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel card">
        <div className="hero" style={{ marginBottom: 20, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0 }}>Динамика за 6 месяцев</h3>
            <p style={{ margin: '8px 0 0' }}>Доходы, расходы и итог по месяцам.</p>
          </div>
        </div>
        <div className="monthly-trend">
          {summary.monthly.map((item) => (
            <article key={item.month} className="trend-card">
              <span>{formatMonthLabel(item.month)}</span>
              <div className="trend-bars">
                <div>
                  <div className="trend-label">Доходы: {formatMoney(item.income)}</div>
                  <div className="trend-bar">
                    <div
                      className="trend-bar-fill income"
                      style={{ width: `${(item.income / monthlyScale) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="trend-label">Расходы: {formatMoney(item.expense)}</div>
                  <div className="trend-bar">
                    <div
                      className="trend-bar-fill expense"
                      style={{ width: `${(item.expense / monthlyScale) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
              <strong className={item.net >= 0 ? 'trend-net positive' : 'trend-net negative'}>
                {item.net >= 0 ? '+' : ''}
                {formatMoney(item.net)}
              </strong>
            </article>
          ))}
        </div>
      </section>

      <section className="grid overview-secondary-grid">
        <article className="panel card">
          <h3>Топ категорий расходов</h3>
          {summary.topExpenseCategories.length > 0 ? (
            <div className="category-breakdown">
              {summary.topExpenseCategories.map((item) => (
                <article key={`expense-${item.categoryId ?? item.categoryName}`} className="category-breakdown-row">
                  <div>
                    <strong>{item.categoryName}</strong>
                    <span>{formatShare(item.share)}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(item.amount)}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0 }}>В этом месяце подтвержденных расходов пока нет.</p>
          )}
        </article>

        <article className="panel card">
          <h3>Топ категорий доходов</h3>
          {summary.topIncomeCategories.length > 0 ? (
            <div className="category-breakdown">
              {summary.topIncomeCategories.map((item) => (
                <article key={`income-${item.categoryId ?? item.categoryName}`} className="category-breakdown-row">
                  <div>
                    <strong>{item.categoryName}</strong>
                    <span>{formatShare(item.share)}</span>
                  </div>
                  <div>
                    <strong>{formatMoney(item.amount)}</strong>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0 }}>В этом месяце подтвержденных доходов пока нет.</p>
          )}
        </article>
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
              <th>Статус</th>
              <th>Комментарий</th>
              <th>Источник</th>
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
                <td>{item.comment?.trim() ? item.comment : '—'}</td>
                <td>{item.sourceMessage?.type ?? '—'}</td>
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
  latestBackup: BackupInfo | null;
  backupMessage: string | null;
  backupError: string | null;
  backupCreating: boolean;
  backupDownloading: boolean;
  settingsMessage: string | null;
  passwordForm: PasswordFormState;
  passwordError: string | null;
  passwordSuccess: string | null;
  onCreateBackup: () => Promise<void>;
  onDownloadLatestBackup: () => Promise<void>;
  onSaveSettings: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onChangePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onPasswordFormChange: (
    updater: (current: PasswordFormState) => PasswordFormState,
  ) => void;
};

export function SettingsSection({
  settings,
  latestBackup,
  backupMessage,
  backupError,
  backupCreating,
  backupDownloading,
  settingsMessage,
  passwordForm,
  passwordError,
  passwordSuccess,
  onCreateBackup,
  onDownloadLatestBackup,
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
        <h3>Бэкапы</h3>
        <p style={{ marginTop: 0 }}>
          Создается локальный backup PostgreSQL только для операций и справочников.
        </p>

        {latestBackup ? (
          <div className="grid" style={{ marginBottom: 16 }}>
            <article className="panel stat">
              <span>Последний файл</span>
              <strong style={{ fontSize: '1rem' }}>{latestBackup.fileName}</strong>
            </article>
            <article className="panel stat">
              <span>Создан</span>
              <strong style={{ fontSize: '1rem' }}>
                {format(new Date(latestBackup.createdAt), 'dd.MM.yyyy HH:mm:ss')}
              </strong>
            </article>
            <article className="panel stat">
              <span>Размер</span>
              <strong style={{ fontSize: '1rem' }}>
                {formatBackupSize(latestBackup.sizeBytes)}
              </strong>
            </article>
          </div>
        ) : (
          <p style={{ marginBottom: 16 }}>Бэкапов пока нет.</p>
        )}

        {backupError ? <p className="error">{backupError}</p> : null}
        {backupMessage ? <p style={{ marginBottom: 16 }}>{backupMessage}</p> : null}

        <div className="actions">
          <button
            className="button"
            type="button"
            disabled={backupCreating}
            onClick={() => void onCreateBackup()}
          >
            {backupCreating ? 'Создание...' : 'Создать бэкап'}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!latestBackup || backupDownloading}
            onClick={() => void onDownloadLatestBackup()}
          >
            {backupDownloading ? 'Скачивание...' : 'Скачать последний'}
          </button>
        </div>
      </div>

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
