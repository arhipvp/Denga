'use client';

import { useMemo, useState } from 'react';
import { DataTable, TablePagination, TableSearch, TableToolbar } from './data-table';
import { CategoryStatusBadge, TransactionTypePill } from './section-shared';
import { useClientTable } from '../../lib/client-table';
import type { Category, SortDirection } from '../../lib/types';

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
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'status'>('type');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);

  const table = useClientTable({
    rows: categories,
    search,
    getSearchValue: (item) =>
      `${item.displayPath} ${item.type} ${item.isActive ? 'active' : 'inactive'}`,
    sortBy,
    sortDir,
    page,
    pageSize: 10,
    filters: [
      (item) =>
        statusFilter === 'all' ||
        (statusFilter === 'active' ? item.isActive : !item.isActive),
      (item) => typeFilter === 'all' || item.type === (typeFilter === 'income' ? 'INCOME' : 'EXPENSE'),
    ],
    comparators: {
      name: (left, right) => left.name.localeCompare(right.name, 'ru'),
      type: (left, right) => left.type.localeCompare(right.type),
      status: (left, right) => Number(left.isActive) - Number(right.isActive),
    },
  });

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Название',
        sortable: true,
        render: (item: Category) => item.displayPath,
      },
      {
        key: 'type',
        label: 'Тип',
        sortable: true,
        render: (item: Category) => <TransactionTypePill type={item.type} />,
      },
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        render: (item: Category) => <CategoryStatusBadge isActive={item.isActive} />,
      },
      {
        key: 'actions',
        label: 'Действия',
        render: (item: Category) => (
          <div className="actions actions--inline">
            <button className="button secondary" type="button" onClick={() => onEdit(item)}>
              Редактировать
            </button>
            {item.isActive ? (
              <button className="button danger" type="button" onClick={() => onDeactivate(item.id)}>
                Отключить
              </button>
            ) : (
              <button className="button" type="button" onClick={() => onRestore(item.id)}>
                Включить
              </button>
            )}
          </div>
        ),
      },
    ],
    [onDeactivate, onEdit, onRestore],
  );

  const handleSortChange = (nextSortBy: string) => {
    const resolved = nextSortBy as typeof sortBy;
    setPage(1);
    if (resolved === sortBy) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(resolved);
    setSortDir(resolved === 'name' ? 'asc' : 'desc');
  };

  return (
    <section className="panel card">
      <TableToolbar
        title="Категории"
        description="Единый справочник доходов и расходов с поиском, сортировкой и статусами."
        filters={
          <>
            <TableSearch
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Название или тип"
            />
            <label className="table-search">
              <span>Статус</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  onStatusFilterChange(event.target.value as typeof statusFilter);
                  setPage(1);
                }}
              >
                <option value="active">Активные</option>
                <option value="inactive">Отключенные</option>
                <option value="all">Все</option>
              </select>
            </label>
            <label className="table-search">
              <span>Тип</span>
              <select
                value={typeFilter}
                onChange={(event) => {
                  onTypeFilterChange(event.target.value as typeof typeFilter);
                  setPage(1);
                }}
              >
                <option value="all">Все типы</option>
                <option value="expense">Расходы</option>
                <option value="income">Доходы</option>
              </select>
            </label>
          </>
        }
        actions={
          <button className="button" type="button" onClick={onCreate}>
            Добавить категорию
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(item) => item.id}
        emptyTitle="Категории не найдены"
        emptyDescription="Измените фильтры или добавьте новую категорию."
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={handleSortChange}
      />
      <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={setPage} />
    </section>
  );
}
