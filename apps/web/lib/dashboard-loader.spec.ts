import {
  DashboardDataLoadError,
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
        case '/transactions?status=confirmed':
          return [{ id: 'tx-1' }];
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
      { status: 'confirmed', type: 'all' },
    );

    expect(dataset).toMatchObject({
      transactions: [{ id: 'tx-1' }],
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
        case '/transactions':
          return [];
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
        { status: 'all', type: 'all' },
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
      loadLogsDataset({ request }, 'token', { level: 'all', source: 'all' }),
    ).rejects.toMatchObject({
      name: 'DashboardDataLoadError',
      resource: 'логи',
      path: '/logs?limit=100',
    } satisfies Partial<DashboardDataLoadError>);
  });
});
