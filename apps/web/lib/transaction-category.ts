import type { TransactionCategory } from './types';

export function getTransactionCategoryPath(category: TransactionCategory | null | undefined) {
  if (!category) {
    return null;
  }

  if (category.displayPath?.trim()) {
    return category.displayPath;
  }

  if (category.parent?.name?.trim()) {
    return `${category.parent.name} / ${category.name}`;
  }

  return category.name?.trim() ? category.name : null;
}
