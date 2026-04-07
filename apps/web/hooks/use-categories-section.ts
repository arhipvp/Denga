'use client';

import { useCallback, useMemo, useState } from 'react';
import { emptyCategoryForm, type Category, type CategoryFormState } from '../lib/types';

function flattenCategories(categories: Category[]): Category[] {
  return categories.flatMap((item) => [item, ...flattenCategories(item.children ?? [])]);
}

export function useCategoriesSection(categories: Category[]) {
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<'active' | 'inactive' | 'all'>(
    'active',
  );
  const [categoryTypeFilter, setCategoryTypeFilter] = useState<'all' | 'income' | 'expense'>(
    'all',
  );
  const [isCategoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(emptyCategoryForm);
  const flattenedCategories = useMemo(() => flattenCategories(categories), [categories]);
  const parentCategories = useMemo(
    () => flattenedCategories.filter((item) => item.parentId === null),
    [flattenedCategories],
  );

  const visibleCategories = useMemo(() => {
    return flattenedCategories.filter((item) => {
      const matchesStatus =
        categoryStatusFilter === 'all' ||
        (categoryStatusFilter === 'active' ? item.isActive : !item.isActive);
      const matchesType =
        categoryTypeFilter === 'all' ||
        item.type === (categoryTypeFilter === 'income' ? 'INCOME' : 'EXPENSE');

      return matchesStatus && matchesType;
    });
  }, [flattenedCategories, categoryStatusFilter, categoryTypeFilter]);

  const openCreateCategoryModal = useCallback(() => {
    setCategoryForm(emptyCategoryForm);
    setCategoryModalOpen(true);
  }, []);

  const openEditCategoryModal = useCallback((category: Category) => {
    setCategoryForm({
      id: category.id,
      name: category.name,
      type: category.type === 'INCOME' ? 'income' : 'expense',
      isActive: category.isActive,
      kind: category.parentId ? 'leaf' : 'parent',
      parentId: category.parentId ?? '',
    });
    setCategoryModalOpen(true);
  }, []);

  const reset = useCallback(() => {
    setCategoryModalOpen(false);
    setCategoryForm(emptyCategoryForm);
  }, []);

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
    parentCategories,
    openCreateCategoryModal,
    openEditCategoryModal,
    reset,
  };
}
