'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  emptyOperationForm,
  type Category,
  type OperationFormState,
  type Transaction,
  type TransactionListFilters,
} from '../lib/types';

const defaultTransactionFilters: TransactionListFilters = {
  status: 'confirmed',
  type: 'all',
  search: '',
  sortBy: 'occurredAt',
  sortDir: 'desc',
  page: 1,
  pageSize: 10,
};

function flattenLeafCategories(categories: Category[]): Category[] {
  return categories.flatMap((item) =>
    item.isLeaf ? [item] : flattenLeafCategories(item.children ?? []),
  );
}

export function useOperationsSection(categories: Category[]) {
  const [filters, setFilters] = useState<TransactionListFilters>(defaultTransactionFilters);
  const [isOperationModalOpen, setOperationModalOpen] = useState(false);
  const [operationForm, setOperationForm] = useState<OperationFormState>(emptyOperationForm);
  const leafCategories = useMemo(() => flattenLeafCategories(categories), [categories]);

  const filteredCategories = useMemo(
    () =>
      leafCategories.filter(
        (item) =>
          item.isActive &&
          item.type === (operationForm.type === 'income' ? 'INCOME' : 'EXPENSE'),
      ),
    [leafCategories, operationForm.type],
  );

  const openCreateOperationModal = useCallback(() => {
    setOperationForm({
      ...emptyOperationForm,
      categoryId:
        leafCategories.find(
          (item) => item.type === 'EXPENSE' && item.isActive,
        )?.id ?? '',
    });
    setOperationModalOpen(true);
  }, [leafCategories]);

  const openEditOperationModal = useCallback((transaction: Transaction) => {
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
  }, []);

  const reset = useCallback(() => {
    setOperationModalOpen(false);
    setOperationForm(emptyOperationForm);
  }, []);

  return {
    filters,
    setFilters,
    isOperationModalOpen,
    setOperationModalOpen,
    operationForm,
    setOperationForm,
    filteredCategories,
    openCreateOperationModal,
    openEditOperationModal,
    reset,
  };
}
