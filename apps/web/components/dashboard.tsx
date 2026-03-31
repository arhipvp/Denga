'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';

type AuthState = {
  accessToken: string;
  user: {
    email: string;
    role: string;
  };
};

type Category = {
  id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  isActive: boolean;
};

type Transaction = {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  occurredAt: string;
  comment: string | null;
  status: 'CONFIRMED' | 'NEEDS_CLARIFICATION' | 'CANCELLED';
  category: Category | null;
  author: { displayName: string } | null;
  sourceMessage: {
    type: string;
    text: string | null;
    attachments: Array<{ id: string; localPath: string | null }>;
    parseAttempts: Array<{
      id: string;
      attemptType: 'INITIAL_PARSE' | 'CLARIFICATION_REPARSE';
      model: string;
      responsePayload: {
        categoryCandidate?: string | null;
        confidence?: number;
        ambiguities?: string[];
        followUpQuestion?: string | null;
      };
    }>;
    clarificationSession?: {
      question: string;
      status: string;
      conversation?: Array<{
        role: 'assistant' | 'user';
        text: string;
        at: string;
      }>;
    } | null;
    reviewDraft?: {
      status: string;
      pendingField: string | null;
      draft: {
        type: 'income' | 'expense' | null;
        amount: number | null;
        occurredAt: string | null;
        categoryName: string | null;
        comment: string | null;
      };
    } | null;
  } | null;
};

type User = {
  id: string;
  displayName: string;
  email: string | null;
  telegramAccounts: Array<{ telegramId: string; username: string | null }>;
};

type Settings = {
  householdName: string;
  defaultCurrency: string;
  telegramMode: 'polling' | 'webhook';
  aiModel: string;
  clarificationTimeoutMinutes: number;
  parsingPrompt: string;
  clarificationPrompt: string;
};

type Summary = {
  totals: {
    income: number;
    expense: number;
    balance: number;
    reviewCount: number;
    cancelledCount: number;
  };
  monthly: Array<{
    month: string;
    income: number;
    expense: number;
    net: number;
  }>;
  recent: Transaction[];
};

type OperationFormState = {
  id?: string;
  type: 'income' | 'expense';
  amount: string;
  occurredAt: string;
  categoryId: string;
  comment: string;
  status: 'confirmed' | 'cancelled';
};

type CategoryFormState = {
  id?: string;
  name: string;
  type: 'income' | 'expense';
  isActive: boolean;
};

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const sections = ['overview', 'operations', 'categories', 'users', 'settings'] as const;
type Section = (typeof sections)[number];

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set');
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

const emptyOperationForm: OperationFormState = {
  type: 'expense',
  amount: '',
  occurredAt: new Date().toISOString().slice(0, 10),
  categoryId: '',
  comment: '',
  status: 'confirmed',
};

const emptyCategoryForm: CategoryFormState = {
  name: '',
  type: 'expense',
  isActive: true,
};

const emptyPasswordForm: PasswordFormState = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

const sectionLabels: Record<Section, string> = {
  overview: 'Обзор',
  operations: 'Операции',
  categories: 'Категории',
  users: 'Пользователи',
  settings: 'Настройки',
};

function formatTransactionTypeLabel(type: 'INCOME' | 'EXPENSE' | 'income' | 'expense' | null) {
  return type === 'INCOME' || type === 'income' ? 'Доход' : type === 'EXPENSE' || type === 'expense' ? 'Расход' : 'Не определено';
}

function formatTransactionStatusLabel(status: 'CONFIRMED' | 'NEEDS_CLARIFICATION' | 'CANCELLED' | 'confirmed' | 'cancelled') {
  if (status === 'CONFIRMED' || status === 'confirmed') return 'Подтверждена';
  if (status === 'NEEDS_CLARIFICATION') return 'Нужно уточнение';
  return 'Отменена';
}

function formatCategoryStatusLabel(isActive: boolean) {
  return isActive ? 'Активна' : 'Отключена';
}

export function Dashboard() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'cancelled'>('confirmed');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [isOperationModalOpen, setOperationModalOpen] = useState(false);
  const [operationForm, setOperationForm] = useState<OperationFormState>(emptyOperationForm);
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<'active' | 'inactive' | 'all'>(
    'active',
  );
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<'all' | 'income' | 'expense'>(
    'all',
  );
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(emptyCategoryForm);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

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

  useEffect(() => {
    const raw = window.localStorage.getItem('denga-auth');
    if (raw) {
      setAuth(JSON.parse(raw));
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      return;
    }
    void reloadData(auth.accessToken, statusFilter, typeFilter);
  }, [auth, statusFilter, typeFilter]);

  const reloadData = async (
    token: string,
    nextStatus: typeof statusFilter,
    nextType: typeof typeFilter,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (nextStatus !== 'all') query.set('status', nextStatus);
      if (nextType !== 'all') query.set('type', nextType);

      const [transactionData, categoryData, userData, settingsData, summaryData] =
        await Promise.all([
          api<Transaction[]>(`/transactions${query.toString() ? `?${query.toString()}` : ''}`, token),
          api<Category[]>('/categories', token),
          api<User[]>('/users', token),
          api<Settings>('/settings', token),
          api<Summary>('/transactions/summary', token),
        ]);

      setTransactions(transactionData);
      setCategories(categoryData);
      setUsers(userData);
      setSettings(settingsData);
      setSummary(summaryData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
      }),
    });

    if (!response.ok) {
      setError('Не удалось выполнить вход');
      return;
    }

    const payload: AuthState = await response.json();
    window.localStorage.setItem('denga-auth', JSON.stringify(payload));
    setAuth(payload);
  };

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth || !settings) return;
    const formData = new FormData(event.currentTarget);
    setSettingsMessage(null);
    const next = await api<Settings>('/settings', auth.accessToken, {
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
    setSettings(next);
    setSettingsMessage('Настройки сохранены');
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) return;

    setPasswordError(null);
    setPasswordSuccess(null);

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Новый пароль и подтверждение не совпадают');
      return;
    }

    try {
      await api<{ success: true }>('/auth/change-password', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm(emptyPasswordForm);
      setPasswordSuccess('Пароль обновлен');
    } catch (passwordChangeError) {
      setPasswordError(
        passwordChangeError instanceof Error
          ? passwordChangeError.message
          : 'Не удалось обновить пароль',
      );
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
    if (!auth) return;
    const payload = {
      type: operationForm.type,
      amount: Number(operationForm.amount),
      occurredAt: new Date(operationForm.occurredAt).toISOString(),
      categoryId: operationForm.categoryId,
      comment: operationForm.comment,
      status: operationForm.status,
    };

    if (operationForm.id) {
      await api(`/transactions/${operationForm.id}`, auth.accessToken, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/transactions', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    setOperationModalOpen(false);
    setOperationForm(emptyOperationForm);
    await reloadData(auth.accessToken, statusFilter, typeFilter);
  };

  const handleCancelOperation = async (id: string) => {
    if (!auth) return;
    await api(`/transactions/${id}`, auth.accessToken, {
      method: 'DELETE',
    });
    await reloadData(auth.accessToken, statusFilter, typeFilter);
  };

  const handleSaveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) return;

    const payload = {
      name: categoryForm.name.trim(),
      type: categoryForm.type,
      isActive: categoryForm.isActive,
    };

    if (categoryForm.id) {
      await api(`/categories/${categoryForm.id}`, auth.accessToken, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      await api('/categories', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    setCategoryModalOpen(false);
    setCategoryForm(emptyCategoryForm);
    await reloadData(auth.accessToken, statusFilter, typeFilter);
  };

  const handleDeactivateCategory = async (id: string) => {
    if (!auth) return;
    await api(`/categories/${id}`, auth.accessToken, {
      method: 'DELETE',
    });
    await reloadData(auth.accessToken, statusFilter, typeFilter);
  };

  const handleRestoreCategory = async (id: string) => {
    if (!auth) return;
    await api(`/categories/${id}`, auth.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: true }),
    });
    await reloadData(auth.accessToken, statusFilter, typeFilter);
  };

  if (!auth) {
    return (
      <div className="login-shell">
        <form className="panel login-card" onSubmit={handleLogin}>
          <h1>Панель Denga</h1>
          <p>Вход только для администратора семейного пространства.</p>
          <div className="field">
            <label htmlFor="email">Электронная почта</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input id="password" name="password" type="password" required />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button className="button" type="submit">
              Войти
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="layout">
        <aside className="panel sidebar">
          <span className="badge">Администратор</span>
          <h1>Denga</h1>
          <p>Семейный журнал доходов и расходов с приемом сообщений через Telegram.</p>
          <div className="nav">
            {sections.map((item) => (
              <button
                key={item}
                className={section === item ? 'active' : ''}
                onClick={() => setSection(item)}
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

          {section === 'overview' && summary ? (
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
                        <td>{item.amount} {item.currency}</td>
                        <td>{item.category?.name ?? 'Не определена'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          ) : null}

          {section === 'operations' ? (
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
                      setStatusFilter(event.target.value as typeof statusFilter)
                    }
                  >
                    <option value="confirmed">подтвержденные</option>
                    <option value="cancelled">отмененные</option>
                    <option value="all">все</option>
                  </select>
                  <select
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(event.target.value as typeof typeFilter)
                    }
                  >
                    <option value="all">все типы</option>
                    <option value="income">доходы</option>
                    <option value="expense">расходы</option>
                  </select>
                  <button className="button" type="button" onClick={openCreateOperationModal}>
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
                            onClick={() => openEditOperationModal(item)}
                          >
                            Редактировать
                          </button>
                          {item.status !== 'CANCELLED' ? (
                            <button
                              className="button danger"
                              type="button"
                              onClick={() => handleCancelOperation(item.id)}
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
          ) : null}

          {section === 'categories' ? (
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
                    value={categoryStatusFilter}
                    onChange={(event) =>
                      setCategoryStatusFilter(
                        event.target.value as typeof categoryStatusFilter,
                      )
                    }
                  >
                    <option value="active">активные</option>
                    <option value="inactive">отключенные</option>
                    <option value="all">все</option>
                  </select>
                  <select
                    value={categoryTypeFilter}
                    onChange={(event) =>
                      setCategoryTypeFilter(event.target.value as typeof categoryTypeFilter)
                    }
                  >
                    <option value="all">все типы</option>
                    <option value="expense">расходы</option>
                    <option value="income">доходы</option>
                  </select>
                  <button className="button" type="button" onClick={openCreateCategoryModal}>
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
                  {visibleCategories.map((item) => (
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
                            onClick={() => openEditCategoryModal(item)}
                          >
                            Редактировать
                          </button>
                          {item.isActive ? (
                            <button
                              className="button danger"
                              type="button"
                              onClick={() => handleDeactivateCategory(item.id)}
                            >
                              Отключить
                            </button>
                          ) : (
                            <button
                              className="button"
                              type="button"
                              onClick={() => handleRestoreCategory(item.id)}
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
          ) : null}

          {section === 'users' ? (
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
          ) : null}

          {section === 'settings' && settings ? (
            <section className="panel card">
              <h3>Настройки</h3>
              <form className="form-grid" onSubmit={handleSaveSettings}>
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
                <form className="form-grid" onSubmit={handleChangePassword}>
                  <div className="field">
                    <label htmlFor="currentPassword">Текущий пароль</label>
                    <input
                      id="currentPassword"
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(event) =>
                        setPasswordForm((current) => ({
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
                        setPasswordForm((current) => ({
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
                        setPasswordForm((current) => ({
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
          ) : null}
        </main>
      </div>

      {isOperationModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 20, 20, 0.35)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <form className="panel card" style={{ width: 'min(620px, 100%)' }} onSubmit={handleSaveOperation}>
            <div className="hero" style={{ marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {operationForm.id ? 'Редактировать операцию' : 'Новая операция'}
                </h3>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() => setOperationModalOpen(false)}
              >
                Закрыть
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Тип</label>
                <select
                  value={operationForm.type}
                  onChange={(event) =>
                    setOperationForm((current) => ({
                      ...current,
                      type: event.target.value as 'income' | 'expense',
                      categoryId: '',
                    }))
                  }
                >
                  <option value="expense">расход</option>
                  <option value="income">доход</option>
                </select>
              </div>
              <div className="field">
                <label>Сумма</label>
                <input
                  value={operationForm.amount}
                  onChange={(event) =>
                    setOperationForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="field">
                <label>Дата</label>
                <input
                  type="date"
                  value={operationForm.occurredAt}
                  onChange={(event) =>
                    setOperationForm((current) => ({
                      ...current,
                      occurredAt: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="field">
                <label>Категория</label>
                <select
                  value={operationForm.categoryId}
                  onChange={(event) =>
                    setOperationForm((current) => ({
                      ...current,
                      categoryId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Выберите категорию</option>
                  {filteredCategories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Статус</label>
                <select
                  value={operationForm.status}
                  onChange={(event) =>
                    setOperationForm((current) => ({
                      ...current,
                      status: event.target.value as 'confirmed' | 'cancelled',
                    }))
                  }
                >
                  <option value="confirmed">подтверждена</option>
                  <option value="cancelled">отменена</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Комментарий</label>
                <textarea
                  value={operationForm.comment}
                  onChange={(event) =>
                    setOperationForm((current) => ({
                      ...current,
                      comment: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="actions" style={{ marginTop: 20 }}>
              <button className="button" type="submit">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isCategoryModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 20, 20, 0.35)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
          }}
        >
          <form className="panel card" style={{ width: 'min(520px, 100%)' }} onSubmit={handleSaveCategory}>
            <div className="hero" style={{ marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {categoryForm.id ? 'Редактировать категорию' : 'Новая категория'}
                </h3>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() => setCategoryModalOpen(false)}
              >
                Закрыть
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Название</label>
                <input
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="field">
                <label>Тип</label>
                <select
                  value={categoryForm.type}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      type: event.target.value as 'income' | 'expense',
                    }))
                  }
                >
                  <option value="expense">расход</option>
                  <option value="income">доход</option>
                </select>
              </div>
              {categoryForm.id ? (
                <div className="field">
                  <label>Статус</label>
                  <select
                    value={categoryForm.isActive ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setCategoryForm((current) => ({
                        ...current,
                        isActive: event.target.value === 'active',
                      }))
                    }
                  >
                    <option value="active">активна</option>
                    <option value="inactive">отключена</option>
                  </select>
                </div>
              ) : null}
            </div>

            <div className="actions" style={{ marginTop: 20 }}>
              <button className="button" type="submit">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
