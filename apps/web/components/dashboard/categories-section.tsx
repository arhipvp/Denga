'use client';

import { useMemo, useState } from 'react';
import { TablePagination, TableSearch, TableToolbar } from './data-table';
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
  onCreateSubcategory: (category: Category) => void;
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
  onCreateSubcategory,
  onEdit,
  onDeactivate,
  onRestore,
}: CategoriesSectionProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'status'>('type');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const normalizedSearch = search.trim().toLowerCase();
  const autoExpandedIds = useMemo(() => {
    if (!normalizedSearch) {
      return [];
    }

    return categories
      .filter((category) =>
        category.children.some((child) =>
          `${child.displayPath} ${child.type} ${child.isActive ? 'active' : 'inactive'}`
            .toLowerCase()
            .includes(normalizedSearch),
        ),
      )
      .map((category) => category.id);
  }, [categories, normalizedSearch]);

  const table = useClientTable({
    rows: categories,
    search,
    getSearchValue: (item) =>
      [
        item.displayPath,
        item.type,
        item.isActive ? 'active' : 'inactive',
        ...item.children.map((child) =>
          `${child.displayPath} ${child.type} ${child.isActive ? 'active' : 'inactive'}`,
        ),
      ].join(' '),
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

  const resolvedExpandedIds = useMemo(
    () => new Set([...expandedIds, ...autoExpandedIds]),
    [autoExpandedIds, expandedIds],
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

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const renderActions = (item: Category) => (
    <>
      <button className="button secondary button--compact" type="button" onClick={() => onEdit(item)}>
        Редактировать
      </button>
      {item.isActive ? (
        <button className="button danger button--compact" type="button" onClick={() => onDeactivate(item.id)}>
          Отключить
        </button>
      ) : (
        <button className="button button--compact" type="button" onClick={() => onRestore(item.id)}>
          Включить
        </button>
      )}
    </>
  );

  return (
    <section className="panel card">
      <TableToolbar
        title="Категории"
        description="Главные категории отображаются таблицей, а подкатегории раскрываются внутри строки родителя."
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
      <div className="table-shell categories-table-shell">
        <table className="table categories-table">
          <thead>
            <tr>
              <th className="categories-table__toggle-head" />
              <th>
                <button
                  className={`sort-button${sortBy === 'name' ? ' active' : ''}`}
                  type="button"
                  onClick={() => handleSortChange('name')}
                >
                  <span>Название</span>
                  <span className="sort-indicator" aria-hidden="true">
                    {sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              </th>
              <th>
                <button
                  className={`sort-button${sortBy === 'type' ? ' active' : ''}`}
                  type="button"
                  onClick={() => handleSortChange('type')}
                >
                  <span>Тип</span>
                  <span className="sort-indicator" aria-hidden="true">
                    {sortBy === 'type' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              </th>
              <th>
                <button
                  className={`sort-button${sortBy === 'status' ? ' active' : ''}`}
                  type="button"
                  onClick={() => handleSortChange('status')}
                >
                  <span>Статус</span>
                  <span className="sort-indicator" aria-hidden="true">
                    {sortBy === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              </th>
              <th>Действия</th>
            </tr>
          </thead>
          {table.rows.length > 0 ? (
            table.rows.map((item) => {
              const isExpanded = resolvedExpandedIds.has(item.id);
              return (
                <tbody key={item.id}>
                  <tr className="categories-row categories-row--parent">
                    <td className="categories-table__toggle-cell">
                      {item.children.length > 0 ? (
                        <button
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? `Скрыть подкатегории ${item.name}` : `Показать подкатегории ${item.name}`}
                          className="categories-toggle"
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                        >
                          <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                        </button>
                      ) : null}
                    </td>
                    <td className="categories-name-cell">
                      <span className="categories-name-cell__label">{item.displayPath}</span>
                    </td>
                    <td>
                      <TransactionTypePill type={item.type} />
                    </td>
                    <td>
                      <CategoryStatusBadge isActive={item.isActive} />
                    </td>
                    <td>
                      <div className="actions categories-actions">
                        <button
                          className="button secondary button--compact"
                          type="button"
                          onClick={() => onCreateSubcategory(item)}
                        >
                          Добавить подкатегорию
                        </button>
                        <div className="actions categories-actions categories-actions--secondary">
                          {renderActions(item)}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {isExpanded ? (
                    item.children.length > 0 ? (
                      item.children.map((child) => (
                        <tr key={child.id} className="categories-row categories-row--child">
                          <td className="categories-table__toggle-cell" />
                          <td className="categories-name-cell categories-name-cell--child">
                            <span className="categories-child-indent" aria-hidden="true" />
                            <span className="categories-name-cell__label">{child.name}</span>
                          </td>
                          <td>
                            <TransactionTypePill type={child.type} />
                          </td>
                          <td>
                            <CategoryStatusBadge isActive={child.isActive} />
                          </td>
                          <td>
                            <div className="actions categories-actions categories-actions--secondary">
                              {renderActions(child)}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr className="categories-row categories-row--empty">
                        <td className="categories-table__toggle-cell" />
                        <td colSpan={4}>
                          <div className="categories-empty-inline">
                            <strong>Подкатегорий пока нет</strong>
                            <span>Добавьте первую подкатегорию для этой главной категории.</span>
                          </div>
                        </td>
                      </tr>
                    )
                  ) : null}
                </tbody>
              );
            })
          ) : (
            <tbody>
              <tr>
                <td colSpan={5}>
                  <div className="empty-state">
                    <strong>Категории не найдены</strong>
                    <span>Измените фильтры или добавьте новую категорию.</span>
                  </div>
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      <TablePagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={setPage} />
    </section>
  );
}
