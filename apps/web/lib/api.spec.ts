import { buildApiUrl, createApiClient, UnauthorizedError } from './api';

describe('api client', () => {
  it('builds endpoint urls from config', () => {
    expect(buildApiUrl('/auth/login', 'http://localhost:3001/api')).toBe(
      'http://localhost:3001/api/auth/login',
    );
  });

  it('throws UnauthorizedError on 401 responses', async () => {
    const client = createApiClient({
      apiUrl: 'http://localhost:3001/api',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn(),
      }),
    });

    await expect(client.request('/transactions', 'token')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
