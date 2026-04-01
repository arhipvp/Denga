import { getWebAppConfig, requireApiUrl } from './config';

export class UnauthorizedError extends Error {
  constructor() {
    super('Сессия истекла, войдите снова');
    this.name = 'UnauthorizedError';
  }
}

type FetchLike = typeof fetch;

type ApiClientOptions = {
  apiUrl?: string | null;
  fetchImpl?: FetchLike;
};

function resolveApiUrl(apiUrl?: string | null) {
  return requireApiUrl({
    apiUrl: apiUrl ?? getWebAppConfig().apiUrl,
  });
}

export function buildApiUrl(path: string, apiUrl?: string | null) {
  const baseUrl = resolveApiUrl(apiUrl);
  return `${baseUrl}${path}`;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
      const response = await fetchImpl(buildApiUrl(path, options.apiUrl), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new UnauthorizedError();
        }

        throw new Error(await response.text());
      }

      return response.json() as Promise<T>;
    },

    async login(email: FormDataEntryValue | null, password: FormDataEntryValue | null) {
      const response = await fetchImpl(buildApiUrl('/auth/login', options.apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!response.ok) {
        throw new Error('Не удалось выполнить вход');
      }

      return response.json();
    },
  };
}
