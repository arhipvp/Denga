'use client';

import type { ReactNode } from 'react';
import type { SortDirection } from '../../lib/types';

export type DataColumn<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  sortKey?: string;
  className?: string;
  render: (row: T) => ReactNode;
};

type SortHeaderProps = {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
};

export function SortHeader({ label, active, direction, onClick }: SortHeaderProps) {
  return (
    <button
      className={`sort-button${active ? ' active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="sort-indicator" aria-hidden="true">
        {active ? (direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  );
}

type DataTableProps<T> = {
  columns: Array<DataColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyTitle: string;
  emptyDescription: string;
  sortBy?: string;
  sortDir?: SortDirection;
  onSortChange?: (sortBy: string) => void;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyTitle,
  emptyDescription,
  sortBy,
  sortDir = 'desc',
  onSortChange,
}: DataTableProps<T>) {
  return (
    <div className="table-shell">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.sortable && onSortChange ? (
                  <SortHeader
                    label={column.label}
                    active={(column.sortKey ?? column.key) === sortBy}
                    direction={sortDir}
                    onClick={() => onSortChange(column.sortKey ?? column.key)}
                  />
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>
                <div className="empty-state">
                  <strong>{emptyTitle}</strong>
                  <span>{emptyDescription}</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type TableSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export function TableSearch({ value, onChange, placeholder }: TableSearchProps) {
  return (
    <label className="table-search">
      <span>Поиск</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type TableToolbarProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  filters?: ReactNode;
};

export function TableToolbar({ title, description, actions, filters }: TableToolbarProps) {
  return (
    <div className="section-toolbar">
      <div className="section-toolbar-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="section-toolbar-actions">
        {filters ? <div className="filter-bar">{filters}</div> : null}
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </div>
  );
}

type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: TablePaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="table-pagination">
      <span className="table-pagination-copy">
        {total === 0 ? 'Нет записей' : `${start}-${end} из ${total}`}
      </span>
      <div className="actions">
        <button
          className="button secondary"
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Назад
        </button>
        <span className="table-pagination-page">
          {page} / {pageCount}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Вперед
        </button>
      </div>
    </div>
  );
}
