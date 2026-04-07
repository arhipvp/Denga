'use client';

import { useMemo, useState } from 'react';
import { DataTable, TablePagination, TableSearch, TableToolbar } from './data-table';
import { useClientTable } from '../../lib/client-table';
import type { SortDirection, User } from '../../lib/types';

export function UsersSection({ users }: { users: User[] }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'displayName' | 'email' | 'telegram'>('displayName');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const table = useClientTable({
    rows: users,
    search,
    getSearchValue: (item) =>
      `${item.displayName} ${item.email ?? ''} ${item.telegramAccounts.map((account) => account.username ?? account.telegramId).join(' ')}`,
    sortBy,
    sortDir,
    page,
    pageSize: 10,
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

  const columns = useMemo(
    () => [
      {
        key: 'displayName',
        label: 'Пользователь',
        sortable: true,
        render: (item: User) => item.displayName,
      },
      {
        key: 'email',
        label: 'Email',
        sortable: true,
        render: (item: User) => item.email ?? 'Только Telegram',
      },
      {
        key: 'telegram',
        label: 'Telegram',
        sortable: true,
        render: (item: User) =>
          item.telegramAccounts.length > 0
            ? item.telegramAccounts.map((account) => account.username ?? account.telegramId).join(', ')
            : '—',
      },
    ],
    [],
  );

  const handleSortChange = (nextSortBy: string) => {
    const resolved = nextSortBy as typeof sortBy;
    setPage(1);
    if (resolved === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(resolved);
    setSortDir('asc');
  };

  return (
    <section className="panel card">
      <TableToolbar
        title="Пользователи"
        description="Сводный список участников системы и связанных Telegram-аккаунтов."
        filters={
          <TableSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Имя, email или Telegram"
          />
        }
      />
      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(item) => item.id}
        emptyTitle="Пользователи не найдены"
        emptyDescription="Добавьте пользователя через Telegram или измените запрос."
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
      />
      <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={setPage} />
    </section>
  );
}
