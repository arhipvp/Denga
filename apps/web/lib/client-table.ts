import { useMemo } from 'react';
import type { SortDirection } from './types';

type UseClientTableOptions<T> = {
  rows: T[];
  search: string;
  getSearchValue: (row: T) => string;
  sortBy: string;
  sortDir: SortDirection;
  page: number;
  pageSize: number;
  comparators: Record<string, (left: T, right: T) => number>;
  filters?: Array<(row: T) => boolean>;
};

export function useClientTable<T>({
  rows,
  search,
  getSearchValue,
  sortBy,
  sortDir,
  page,
  pageSize,
  comparators,
  filters = [],
}: UseClientTableOptions<T>) {
  return useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (filters.some((predicate) => !predicate(row))) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return getSearchValue(row).toLowerCase().includes(normalizedSearch);
    });

    const comparator = comparators[sortBy];
    const sorted = comparator
      ? [...filtered].sort((left, right) => {
          const result = comparator(left, right);
          return sortDir === 'asc' ? result : -result;
        })
      : filtered;

    const total = sorted.length;
    const safePageSize = Math.max(pageSize, 1);
    const pageCount = Math.max(Math.ceil(total / safePageSize), 1);
    const safePage = Math.min(Math.max(page, 1), pageCount);
    const start = (safePage - 1) * safePageSize;

    return {
      rows: sorted.slice(start, start + safePageSize),
      total,
      page: safePage,
      pageSize: safePageSize,
      pageCount,
    };
  }, [comparators, filters, getSearchValue, page, pageSize, rows, search, sortBy, sortDir]);
}
