import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useCategoriesSection } from './use-categories-section';
import type { Category } from '../lib/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HookSnapshot = ReturnType<typeof useCategoriesSection> | null;

const categoriesFixture: Category[] = [
  {
    id: 'parent-expense',
    parentId: null,
    name: 'Еда',
    type: 'EXPENSE',
    isActive: true,
    isLeaf: false,
    displayPath: 'Еда',
    children: [
      {
        id: 'child-expense',
        parentId: 'parent-expense',
        name: 'Кафе',
        type: 'EXPENSE',
        isActive: true,
        isLeaf: true,
        displayPath: 'Еда / Кафе',
        children: [],
      },
    ],
  },
  {
    id: 'parent-income',
    parentId: null,
    name: 'Зарплата',
    type: 'INCOME',
    isActive: false,
    isLeaf: false,
    displayPath: 'Зарплата',
    children: [],
  },
];

let latestHook: HookSnapshot = null;

function TestHarness({ categories }: { categories: Category[] }) {
  const hook = useCategoriesSection(categories);

  React.useEffect(() => {
    latestHook = hook;
  }, [hook]);

  return null;
}

describe('useCategoriesSection', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    latestHook = null;
    if (renderer) {
      act(() => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it('returns only parent categories in visibleCategories by default', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { categories: categoriesFixture }));
    });

    expect(latestHook?.parentCategories.map((item) => item.id)).toEqual([
      'parent-expense',
      'parent-income',
    ]);
    expect(latestHook?.visibleCategories.map((item) => item.id)).toEqual(['parent-expense']);
  });

  it('opens subcategory modal with prefilled parent, type and leaf kind', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { categories: categoriesFixture }));
    });

    await act(async () => {
      latestHook?.openCreateSubcategoryModal(categoriesFixture[0]);
    });

    expect(latestHook?.isCategoryModalOpen).toBe(true);
    expect(latestHook?.categoryForm).toMatchObject({
      name: '',
      type: 'expense',
      isActive: true,
      kind: 'leaf',
      parentId: 'parent-expense',
    });
  });

  it('applies status and type filters to parent categories only', async () => {
    await act(async () => {
      renderer = create(React.createElement(TestHarness, { categories: categoriesFixture }));
    });

    await act(async () => {
      latestHook?.setCategoryStatusFilter('all');
      latestHook?.setCategoryTypeFilter('income');
    });

    expect(latestHook?.visibleCategories.map((item) => item.id)).toEqual(['parent-income']);
  });
});
