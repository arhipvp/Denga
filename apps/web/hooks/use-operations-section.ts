'use client';

import { useCallback, useMemo, useState } from 'react';
import { emptyOperationForm, type Category, type OperationFormState, type Transaction } from '../lib/types';

export function useOperationsSection(categories: Category[]) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'cancelled'>(
    'confirmed',
  );
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
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
    statusFilter,
    setStatusFilter,
    typeFilter,
    setTypeFilter,
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
