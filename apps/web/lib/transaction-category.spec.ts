import { getTransactionCategoryPath } from './transaction-category';

describe('getTransactionCategoryPath', () => {
  it('returns displayPath when present', () => {
    expect(
      getTransactionCategoryPath({
        id: 'cat-1',
        parentId: 'parent-1',
        name: 'Кафе',
        type: 'EXPENSE',
        isActive: true,
        isLeaf: true,
        displayPath: 'Еда / Кафе',
        children: [],
      }),
    ).toBe('Еда / Кафе');
  });

  it('builds path from parent name when displayPath is missing', () => {
    expect(
      getTransactionCategoryPath({
        id: 'cat-1',
        parentId: 'parent-1',
        name: 'Кафе',
        type: 'EXPENSE',
        isActive: true,
        isLeaf: true,
        displayPath: '',
        children: [],
        parent: {
          id: 'parent-1',
          parentId: null,
          name: 'Еда',
          type: 'EXPENSE',
          isActive: true,
        },
      }),
    ).toBe('Еда / Кафе');
  });

  it('returns null when category is missing', () => {
    expect(getTransactionCategoryPath(null)).toBeNull();
  });
});
