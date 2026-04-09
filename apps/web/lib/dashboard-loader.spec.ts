import { UnauthorizedError } from './api';
import {
  DashboardDataLoadError,
  isUnauthorizedLike,
  loadDashboardDataset,
  loadLogsDataset,
} from './dashboard-loader';

describe('dashboard loader', () => {
  const summaryPayload = {
    totals: {
      currentPeriod: { income: 1200, expense: 400, balance: 800 },
      previousPeriod: { income: 1000, expense: 500, balance: 500 },
    },
    diffs: {
      income: 200,
      expense: -100,
      balance: 300,
    },
    counts: {
      operations: 4,
      income: 1,
      expense: 3,
      cancelled: 1,
    },
    average: {
      income: 1200,
      expense: 133.33,
      transaction: 400,
    },
    topExpenseCategories: [],
    topIncomeCategories: [],
    monthly: [],
    recent: [],
  };

  it('loads all primary dashboard resources', async () => {
    const request = jest.fn(async (path: string) => {
      switch (path) {
        case '/transactions?status=confirmed&sortBy=occurredAt&sortDir=desc&page=1&pageSize=20':
          return { items: [{ id: 'tx-1' }], total: 1, page: 1, pageSize: 20 };
        case '/categories':
          return [{ id: 'cat-1' }];
        case '/users':
          return [{ id: 'user-1' }];
        case '/settings':
          return { householdName: 'Denga' };
        case '/transactions/summary':
          return summaryPayload;
        case '/backups/latest':
          return null;
        default:
          throw new Error(`Unexpected path ${path}`);
      }
    });

    const dataset = await loadDashboardDataset(
      { request },
      'token',
      {
        status: 'confirmed',
        type: 'all',
        search: '',
        sortBy: 'occurredAt',
        sortDir: 'desc',
        page: 1,
        pageSize: 20,
      },
    );

    expect(dataset).toMatchObject({
      transactions: {
        items: [{ id: 'tx-1' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      categories: [{ id: 'cat-1' }],
      users: [{ id: 'user-1' }],
      settings: { householdName: 'Denga' },
      summary: summaryPayload,
      latestBackup: null,
    });
  });

  it('reports which resource failed when a required endpoint returns empty body', async () => {
    const request = jest.fn(async (path: string) => {
      switch (path) {
        case '/transactions?sortBy=occurredAt&sortDir=desc&page=1&pageSize=20':
          return { items: [], total: 0, page: 1, pageSize: 20 };
        case '/categories':
          return [];
        case '/users':
          return [];
        case '/settings':
          return null;
        case '/transactions/summary':
          return summaryPayload;
        case '/backups/latest':
          return null;
        default:
          throw new Error(`Unexpected path ${path}`);
      }
    });

    await expect(
      loadDashboardDataset(
        { request },
        'token',
        {
          status: 'all',
          type: 'all',
          search: '',
          sortBy: 'occurredAt',
          sortDir: 'desc',
          page: 1,
          pageSize: 20,
        },
      ),
    ).rejects.toMatchObject({
      name: 'DashboardDataLoadError',
      resource: 'настройки',
      path: '/settings',
    } satisfies Partial<DashboardDataLoadError>);
  });

  it('reports which log request failed', async () => {
    const request = jest.fn().mockResolvedValue(null);

    await expect(
      loadLogsDataset(
        { request },
        'token',
        {
          level: 'all',
          source: 'all',
          search: '',
          sortBy: 'timestamp',
          sortDir: 'desc',
          page: 1,
          pageSize: 20,
        },
      ),
    ).rejects.toMatchObject({
      name: 'DashboardDataLoadError',
      resource: 'логи',
      path: '/logs?sortBy=timestamp&sortDir=desc&page=1&pageSize=20',
    } satisfies Partial<DashboardDataLoadError>);
  });

  it('recognizes UnauthorizedError nested inside dashboard loader errors', () => {
    const error = new DashboardDataLoadError(
      'операции',
      '/transactions?sortBy=occurredAt&sortDir=desc&page=1&pageSize=20',
      new Error('outer wrapper', {
        cause: new UnauthorizedError(),
      }),
    );

    expect(isUnauthorizedLike(error)).toBe(true);
  });

  it('does not treat non-auth loader errors as unauthorized', () => {
    const error = new DashboardDataLoadError(
      'операции',
      '/transactions?sortBy=occurredAt&sortDir=desc&page=1&pageSize=20',
      new Error('network failed'),
    );

    expect(isUnauthorizedLike(error)).toBe(false);
  });
});
