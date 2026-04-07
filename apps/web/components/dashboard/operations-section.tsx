'use client';

import { useMemo } from 'react';
import { DataTable, TablePagination, TableSearch, TableToolbar } from './data-table';
import { MoneyText, TransactionStatusBadge, TransactionTypePill } from './section-shared';
import { formatDate } from '../../lib/formatters';
import { getTransactionCategoryPath } from '../../lib/transaction-category';
import type { Transaction, TransactionListFilters } from '../../lib/types';

type OperationsSectionProps = {
  transactions: { items: Transaction[]; total: number; page: number; pageSize: number };
  filters: TransactionListFilters;
  onFiltersChange: (updater: (current: TransactionListFilters) => TransactionListFilters) => void;
  onCreate: () => void;
  onEdit: (transaction: Transaction) => void;
  onCancel: (id: string) => void;
};

export function OperationsSection({
  transactions,
  filters,
  onFiltersChange,
  onCreate,
  onEdit,
  onCancel,
}: OperationsSectionProps) {
  const columns = useMemo(
    () => [
      {
        key: 'occurredAt',
        label: 'Дата',
        sortable: true,
        render: (item: Transaction) => formatDate(item.occurredAt),
      },
      {
        key: 'type',
        label: 'Тип',
        sortable: true,
        render: (item: Transaction) => <TransactionTypePill type={item.type} />,
      },
      {
        key: 'amount',
        label: 'Сумма',
        sortable: true,
        render: (item: Transaction) => (
          <MoneyText
            value={item.amount}
            currency={item.currency}
            tone={item.type === 'INCOME' ? 'income' : 'expense'}
          />
        ),
      },
      {
        key: 'category',
        label: 'Категория',
        sortable: true,
        render: (item: Transaction) => getTransactionCategoryPath(item.category) ?? 'Не определена',
      },
      {
        key: 'comment',
        label: 'Примечание',
        render: (item: Transaction) => item.comment?.trim() ? item.comment : '—',
      },
      {
        key: 'author',
        label: 'Автор',
        sortable: true,
        render: (item: Transaction) => item.author?.displayName ?? 'Система',
      },
      {
        key: 'status',
        label: 'Статус',
        sortable: true,
        render: (item: Transaction) => <TransactionStatusBadge status={item.status} />,
      },
      {
        key: 'actions',
        label: 'Действия',
        render: (item: Transaction) => (
          <div className="actions actions--inline">
            <button className="button secondary" type="button" onClick={() => onEdit(item)}>
              Редактировать
            </button>
            {item.status !== 'CANCELLED' ? (
              <button className="button danger" type="button" onClick={() => onCancel(item.id)}>
                Отменить
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [onCancel, onEdit],
  );

  const handleSortChange = (sortBy: string) => {
    onFiltersChange((current) => ({
      ...current,
      sortBy: sortBy as TransactionListFilters['sortBy'],
      sortDir: current.sortBy === sortBy && current.sortDir === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  return (
    <section className="panel card">
      <TableToolbar
        title="Операции"
        description="Серверная сортировка, поиск и фильтрация по ключевым полям."
        filters={
          <>
            <TableSearch
              value={filters.search}
              onChange={(value) =>
                onFiltersChange((current) => ({ ...current, search: value, page: 1 }))
              }
              placeholder="Комментарий, категория, автор"
            />
            <label className="table-search">
              <span>Статус</span>
              <select
                value={filters.status}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    status: event.target.value as TransactionListFilters['status'],
                    page: 1,
                  }))
                }
              >
                <option value="confirmed">Подтвержденные</option>
                <option value="cancelled">Отмененные</option>
                <option value="all">Все</option>
              </select>
            </label>
            <label className="table-search">
              <span>Тип</span>
              <select
                value={filters.type}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    type: event.target.value as TransactionListFilters['type'],
                    page: 1,
                  }))
                }
              >
                <option value="all">Все типы</option>
                <option value="income">Доходы</option>
                <option value="expense">Расходы</option>
              </select>
            </label>
          </>
        }
        actions={
          <button className="button" type="button" onClick={onCreate}>
            Добавить операцию
          </button>
        }
      />
      <DataTable
        columns={columns}
        rows={transactions.items}
        rowKey={(item) => item.id}
        emptyTitle="Операции не найдены"
        emptyDescription="Попробуйте сбросить фильтры или измените поисковый запрос."
        sortBy={filters.sortBy}
        sortDir={filters.sortDir}
        onSortChange={handleSortChange}
      />
      <TablePagination
        page={transactions.page}
        pageSize={transactions.pageSize}
        total={transactions.total}
        onPageChange={(page) => onFiltersChange((current) => ({ ...current, page }))}
      />
    </section>
  );
}
