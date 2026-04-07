import { getWebAppConfig, requireApiUrl } from './config';

export class UnauthorizedError extends Error {
  constructor() {
    super('Сессия истекла, войдите снова');
    this.name = 'UnauthorizedError';
  }
}

export class ApiResponseParseError extends Error {
  constructor(
    message: string,
    readonly details: {
      path: string;
      status: number;
      contentType: string | null;
      bodyEmpty: boolean;
    },
  ) {
    super(message);
    this.name = 'ApiResponseParseError';
  }
}

type FetchLike = typeof fetch;

type ApiClientOptions = {
  apiUrl?: string | null;
  fetchImpl?: FetchLike;
};

type DownloadResult = {
  blob: Blob;
  fileName: string | null;
};

function extractApiErrorMessage(rawBody: string) {
  const body = rawBody.trim();

  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(', ');
    }

    return typeof parsed.message === 'string' ? parsed.message : body;
  } catch {
    return body;
  }
}

function resolveApiUrl(apiUrl?: string | null) {
  return requireApiUrl({
    apiUrl: apiUrl ?? getWebAppConfig().apiUrl,
  });
}

function extractFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

async function parseJsonResponse<T>(
  response: Response,
  path: string,
  options: { allowEmpty: boolean } = { allowEmpty: true },
): Promise<T | null> {
  const rawBody = await response.text();
  const body = rawBody.trim();

  if (!body) {
    if (options.allowEmpty) {
      return null;
    }

    throw new ApiResponseParseError(`Пустой ответ от API: ${path}`, {
      path,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyEmpty: true,
    });
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiResponseParseError(`Некорректный JSON от API: ${path}`, {
      path,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bodyEmpty: false,
    });
  }
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

        const message = extractApiErrorMessage(await response.text());
        throw new Error(message || `API request failed: ${path} (${response.status})`);
      }

      return (await parseJsonResponse<T>(response, path)) as T;
    },

    async download(path: string, token: string, init?: RequestInit): Promise<DownloadResult> {
      const response = await fetchImpl(buildApiUrl(path, options.apiUrl), {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new UnauthorizedError();
        }

        throw new Error(
          extractApiErrorMessage(await response.text()) ||
            `API request failed: ${path} (${response.status})`,
        );
      }

      return {
        blob: await response.blob(),
        fileName: extractFileName(response.headers.get('content-disposition')),
      };
    },

    async login(email: FormDataEntryValue | null, password: FormDataEntryValue | null) {
      const path = '/auth/login';
      const response = await fetchImpl(buildApiUrl(path, options.apiUrl), {
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

      return parseJsonResponse(response, path, { allowEmpty: false });
    },
  };
}
