import {
  DashboardDataLoadError,
  loadDashboardDataset,
  loadLogsDataset,
} from './dashboard-loader';

describe('dashboard loader', () => {
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
          return { totals: {}, monthly: [], recent: [] };
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
      summary: { totals: {}, monthly: [], recent: [] },
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
          return { totals: {}, monthly: [], recent: [] };
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
