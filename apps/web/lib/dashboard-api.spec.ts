import { createDashboardFeatureApi } from './dashboard-api';

describe('dashboard feature api', () => {
  it('routes operation writes through feature-specific methods', async () => {
    const request = jest.fn().mockResolvedValue({ ok: true });
    const api = createDashboardFeatureApi({
      request,
      download: jest.fn(),
      login: jest.fn(),
    });

    await api.operations.save('token', {
      id: 'tx-1',
      type: 'expense',
      amount: 19.5,
      occurredAt: '2026-04-03T00:00:00.000Z',
      categoryId: 'cat-1',
      comment: 'Такси',
      status: 'confirmed',
    });

    expect(request).toHaveBeenCalledWith(
      '/transactions/tx-1',
      'token',
      expect.objectContaining({
        method: 'PATCH',
      }),
    );
  });

  it('uses dedicated settings methods for backup download', async () => {
    const download = jest.fn().mockResolvedValue({
      blob: new Blob(['x']),
      fileName: 'ops.dump',
    });
    const api = createDashboardFeatureApi({
      request: jest.fn(),
      download,
      login: jest.fn(),
    });

    await expect(api.settings.downloadLatestBackup('token')).resolves.toMatchObject({
      fileName: 'ops.dump',
    });
    expect(download).toHaveBeenCalledWith('/backups/latest/download', 'token');
  });
});
