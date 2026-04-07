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

export function useOperationsSection(categories: Category[]) {
  const [filters, setFilters] = useState<TransactionListFilters>(defaultTransactionFilters);
  const [isOperationModalOpen, setOperationModalOpen] = useState(false);
  const [operationForm, setOperationForm] = useState<OperationFormState>(emptyOperationForm);

  const filteredCategories = useMemo(
    () =>
      categories.filter(
        (item) =>
          item.isActive &&
          item.type === (operationForm.type === 'income' ? 'INCOME' : 'EXPENSE'),
      ),
    [categories, operationForm.type],
  );

  const openCreateOperationModal = useCallback(() => {
    setOperationForm({
      ...emptyOperationForm,
      categoryId: categories.find((item) => item.type === 'EXPENSE')?.id ?? '',
    });
    setOperationModalOpen(true);
  }, [categories]);

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
