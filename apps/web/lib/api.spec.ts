import {
  ApiResponseParseError,
  buildApiUrl,
  createApiClient,
  UnauthorizedError,
} from './api';

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

  it('downloads binary responses and extracts filename', async () => {
    const blob = new Blob(['backup']);
    const client = createApiClient({
      apiUrl: 'http://localhost:3001/api',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('attachment; filename="denga-ops.dump"'),
        },
        blob: jest.fn().mockResolvedValue(blob),
      }),
    });

    await expect(client.download('/backups/latest/download', 'token')).resolves.toEqual({
      blob,
      fileName: 'denga-ops.dump',
    });
  });

  it('returns null for a successful empty JSON body', async () => {
    const client = createApiClient({
      apiUrl: 'http://localhost:3001/api',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn().mockReturnValue('application/json'),
        },
        text: jest.fn().mockResolvedValue(''),
      }),
    });

    await expect(client.request('/backups/latest', 'token')).resolves.toBeNull();
  });

  it('throws a parse error with path context for invalid json', async () => {
    const client = createApiClient({
      apiUrl: 'http://localhost:3001/api',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn().mockReturnValue('application/json'),
        },
        text: jest.fn().mockResolvedValue('{'),
      }),
    });

    await expect(client.request('/settings', 'token')).rejects.toMatchObject({
      name: 'ApiResponseParseError',
      details: {
        path: '/settings',
        status: 200,
        contentType: 'application/json',
        bodyEmpty: false,
      },
    } satisfies Partial<ApiResponseParseError>);
  });
});
