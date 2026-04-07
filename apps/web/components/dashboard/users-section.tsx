'use client';

import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { TablePagination, TableSearch, TableToolbar } from './data-table';
import { useClientTable } from '../../lib/client-table';
import type { SortDirection, User } from '../../lib/types';

type UsersSectionProps = {
  users: User[];
  onRenameUser: (id: string, displayName: string) => Promise<boolean>;
};

export function UsersSection({ users, onRenameUser }: UsersSectionProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'displayName' | 'email' | 'telegram'>('displayName');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const table = useClientTable({
    rows: users,
    search,
    getSearchValue: (item) =>
      [
        item.displayName,
        item.email ?? '',
        item.role,
        item.telegramAccounts.map((account) => account.username ?? account.telegramId).join(' '),
      ].join(' '),
    sortBy,
    sortDir,
    page,
    pageSize: 8,
    comparators: {
      displayName: (left, right) => left.displayName.localeCompare(right.displayName, 'ru'),
      email: (left, right) => (left.email ?? '').localeCompare(right.email ?? '', 'ru'),
      telegram: (left, right) =>
        (left.telegramAccounts[0]?.username ?? left.telegramAccounts[0]?.telegramId ?? '').localeCompare(
          right.telegramAccounts[0]?.username ?? right.telegramAccounts[0]?.telegramId ?? '',
          'ru',
        ),
    },
  });

  const stats = useMemo(
    () => ({
      total: users.length,
      withEmail: users.filter((user) => Boolean(user.email)).length,
      withTelegram: users.filter((user) => user.telegramAccounts.length > 0).length,
    }),
    [users],
  );

  const handleSortChange = (nextSortBy: typeof sortBy) => {
    setPage(1);
    if (nextSortBy === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortBy(nextSortBy);
    setSortDir('asc');
  };

  const startRename = (user: User) => {
    setEditingUserId(user.id);
    setDraftName(user.displayName);
    setRenameError(null);
  };

  const cancelRename = () => {
    setEditingUserId(null);
    setDraftName('');
    setRenameError(null);
    setSavingUserId(null);
  };

  const submitRename = async (userId: string) => {
    const nextDisplayName = draftName.trim();
    if (!nextDisplayName) {
      setRenameError('Имя не может быть пустым');
      return;
    }

    setSavingUserId(userId);
    setRenameError(null);
    const success = await onRenameUser(userId, nextDisplayName);
    setSavingUserId(null);

    if (success) {
      cancelRename();
      return;
    }

    setRenameError('Не удалось сохранить новое имя');
  };

  return (
    <section className="panel card">
      <TableToolbar
        title="Пользователи"
        description="Сводный список участников системы, их ролей и связанных Telegram-аккаунтов."
        filters={
          <TableSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Имя, email, роль или Telegram"
          />
        }
        actions={
          <div className="users-stats">
            <span className="badge info">Всего: {stats.total}</span>
            <span className="badge success">С email: {stats.withEmail}</span>
            <span className="badge warn">С Telegram: {stats.withTelegram}</span>
          </div>
        }
      />

      <div className="users-sortbar">
        <div className="actions">
          <button className="button secondary button--compact" type="button" onClick={() => handleSortChange('displayName')}>
            Имя {sortBy === 'displayName' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button className="button secondary button--compact" type="button" onClick={() => handleSortChange('email')}>
            Email {sortBy === 'email' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
          <button className="button secondary button--compact" type="button" onClick={() => handleSortChange('telegram')}>
            Telegram {sortBy === 'telegram' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
        </div>
      </div>

      <div className="users-grid">
        {table.rows.length > 0 ? (
          table.rows.map((user) => {
            const isEditing = editingUserId === user.id;
            const isSaving = savingUserId === user.id;

            return (
              <article className="users-card" key={user.id}>
                <div className="users-card__header">
                  <div className="users-card__identity">
                    {isEditing ? (
                      <label className="field users-card__edit-field">
                        <span>Имя пользователя</span>
                        <input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus />
                      </label>
                    ) : (
                      <>
                        <h4>{user.displayName}</h4>
                        <p>{user.email ?? 'Только Telegram'}</p>
                      </>
                    )}
                  </div>
                  <div className="users-card__badges">
                    <span className={`badge ${user.role === 'ADMIN' ? 'info' : 'success'}`}>
                      {user.role === 'ADMIN' ? 'Администратор' : 'Участник'}
                    </span>
                    <span className={`badge ${user.telegramAccounts.some((account) => account.isActive) ? 'success' : 'warn'}`}>
                      {user.telegramAccounts.some((account) => account.isActive)
                        ? 'Telegram активен'
                        : user.telegramAccounts.length > 0
                          ? 'Telegram отключен'
                          : 'Нет Telegram'}
                    </span>
                  </div>
                </div>

                <div className="users-card__meta">
                  <div>
                    <span>Создан</span>
                    <strong>{format(new Date(user.createdAt), 'dd.MM.yyyy')}</strong>
                  </div>
                  <div>
                    <span>Связок Telegram</span>
                    <strong>{user.telegramAccounts.length}</strong>
                  </div>
                </div>

                <div className="users-card__telegram">
                  <span>Telegram-аккаунты</span>
                  {user.telegramAccounts.length > 0 ? (
                    <div className="users-telegram-list">
                      {user.telegramAccounts.map((account) => (
                        <div className="users-telegram-chip" key={account.telegramId}>
                          <strong>{account.username ? `@${account.username}` : account.telegramId}</strong>
                          <span className={`badge ${account.isActive ? 'success' : 'warn'}`}>
                            {account.isActive ? 'Активен' : 'Выключен'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-copy">Аккаунты Telegram еще не привязаны.</p>
                  )}
                </div>

                {isEditing && renameError ? <p className="error">{renameError}</p> : null}

                <div className="actions">
                  {isEditing ? (
                    <>
                      <button className="button secondary" type="button" disabled={isSaving} onClick={cancelRename}>
                        Отмена
                      </button>
                      <button className="button" type="button" disabled={isSaving} onClick={() => void submitRename(user.id)}>
                        {isSaving ? 'Сохранение...' : 'Сохранить имя'}
                      </button>
                    </>
                  ) : (
                    <button className="button secondary" type="button" onClick={() => startRename(user)}>
                      Переименовать
                    </button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-state users-empty-state">
            <strong>Пользователи не найдены</strong>
            <span>Добавьте пользователя через Telegram или измените поисковый запрос.</span>
          </div>
        )}
      </div>

      <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={setPage} />
    </section>
  );
}
