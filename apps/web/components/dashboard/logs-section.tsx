'use client';

import { useMemo } from 'react';
import { DataTable, TablePagination, TableSearch, TableToolbar } from './data-table';
import { formatDate } from '../../lib/formatters';
import type { LogEntry, LogListFilters, PagedResponse } from '../../lib/types';

type LogsSectionProps = {
  logs: PagedResponse<LogEntry>;
  logsLoading: boolean;
  logsError: string | null;
  logSources: string[];
  filters: LogListFilters;
  onFiltersChange: (updater: (current: LogListFilters) => LogListFilters) => void;
  onRefresh: () => void;
};

export function LogsSection({
  logs,
  logsLoading,
  logsError,
  logSources,
  filters,
  onFiltersChange,
  onRefresh,
}: LogsSectionProps) {
  const columns = useMemo(
    () => [
      {
        key: 'timestamp',
        label: 'Время',
        sortable: true,
        render: (item: LogEntry) => formatDate(item.timestamp, true),
      },
      {
        key: 'level',
        label: 'Уровень',
        sortable: true,
        render: (item: LogEntry) => (
          <span className={item.level === 'error' ? 'badge danger' : item.level === 'warn' ? 'badge warn' : 'badge info'}>
            {item.level}
          </span>
        ),
      },
      {
        key: 'source',
        label: 'Источник',
        sortable: true,
        render: (item: LogEntry) => item.source,
      },
      {
        key: 'event',
        label: 'Событие',
        sortable: true,
        render: (item: LogEntry) => item.event,
      },
      {
        key: 'message',
        label: 'Сообщение',
        render: (item: LogEntry) => item.message,
      },
    ],
    [],
  );

  const handleSortChange = (sortBy: string) => {
    onFiltersChange((current) => ({
      ...current,
      sortBy: sortBy as LogListFilters['sortBy'],
      sortDir: current.sortBy === sortBy && current.sortDir === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  return (
    <section className="panel card">
      <TableToolbar
        title="Системные логи"
        description="Серверный поиск и сортировка по журналу backend-событий."
        filters={
          <>
            <TableSearch
              value={filters.search}
              onChange={(value) => onFiltersChange((current) => ({ ...current, search: value, page: 1 }))}
              placeholder="Источник, событие или сообщение"
            />
            <label className="table-search">
              <span>Уровень</span>
              <select
                value={filters.level}
                onChange={(event) =>
                  onFiltersChange((current) => ({
                    ...current,
                    level: event.target.value as LogListFilters['level'],
                    page: 1,
                  }))
                }
              >
                <option value="all">Все уровни</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
                <option value="debug">Debug</option>
              </select>
            </label>
            <label className="table-search">
              <span>Источник</span>
              <select
                value={filters.source}
                onChange={(event) =>
                  onFiltersChange((current) => ({ ...current, source: event.target.value, page: 1 }))
                }
              >
                <option value="all">Все источники</option>
                {logSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
        actions={
          <button className="button secondary" type="button" onClick={onRefresh}>
            Обновить
          </button>
        }
      />

      {logsLoading ? <p className="empty-copy">Загрузка логов...</p> : null}
      {logsError ? <p className="error">{logsError}</p> : null}

      {!logsError ? (
        <>
          <DataTable
            columns={columns}
            rows={logs.items}
            rowKey={(item, index) => `${item.timestamp}-${item.event}-${index}`}
            emptyTitle="Логи не найдены"
            emptyDescription="Измените фильтры или обновите журнал."
            sortBy={filters.sortBy}
            sortDir={filters.sortDir}
            onSortChange={handleSortChange}
          />
          <TablePagination
            page={logs.page}
            pageSize={logs.pageSize}
            total={logs.total}
            onPageChange={(page) => onFiltersChange((current) => ({ ...current, page }))}
          />
        </>
      ) : null}
    </section>
  );
}
