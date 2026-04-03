'use client';

import { useMemo, useState } from 'react';
import { emptyCategoryForm, type Category, type CategoryFormState } from '../lib/types';

export function useCategoriesSection(categories: Category[]) {
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<'active' | 'inactive' | 'all'>(
    'active',
  );
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<'all' | 'income' | 'expense'>(
    'all',
  );
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(emptyCategoryForm);

  const visibleCategories = useMemo(() => {
    return categories.filter((item) => {
      const matchesStatus =
        categoryStatusFilter === 'all' ||
        (categoryStatusFilter === 'active' ? item.isActive : !item.isActive);
      const matchesType =
        categoryTypeFilter === 'all' ||
        item.type === (categoryTypeFilter === 'income' ? 'INCOME' : 'EXPENSE');

      return matchesStatus && matchesType;
    });
  }, [categories, categoryStatusFilter, categoryTypeFilter]);

  const openCreateCategoryModal = () => {
    setCategoryForm(emptyCategoryForm);
    setCategoryModalOpen(true);
  };

  const openEditCategoryModal = (category: Category) => {
    setCategoryForm({
      id: category.id,
      name: category.name,
      type: category.type === 'INCOME' ? 'income' : 'expense',
      isActive: category.isActive,
    });
    setCategoryModalOpen(true);
  };

  const reset = () => {
    setCategoryModalOpen(false);
    setCategoryForm(emptyCategoryForm);
  };

  return {
    categoryStatusFilter,
    setCategoryStatusFilter,
    categoryTypeFilter,
    setCategoryTypeFilter,
    isCategoryModalOpen,
    setCategoryModalOpen,
    categoryForm,
    setCategoryForm,
    visibleCategories,
    openCreateCategoryModal,
    openEditCategoryModal,
    reset,
  };
}
