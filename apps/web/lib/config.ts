export class MissingApiUrlError extends Error {
  constructor() {
    super(
      'NEXT_PUBLIC_API_URL is not set. Set it in the environment before starting the web app.',
    );
    this.name = 'MissingApiUrlError';
  }
}

export type WebAppConfig = {
  apiUrl: string | null;
};

function normalizeApiUrl(apiUrl?: string | null) {
  const trimmed = apiUrl?.trim();

  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

// Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build time.
// Reading directly here keeps server and client on the same source of truth.
const compileTimeApiUrl = process.env.NEXT_PUBLIC_API_URL;

export function getWebAppConfig(apiUrl = compileTimeApiUrl): WebAppConfig {
  return {
    apiUrl: normalizeApiUrl(apiUrl),
  };
}

export function requireApiUrl(config = getWebAppConfig()): string {
  if (!config.apiUrl) {
    throw new MissingApiUrlError();
  }

  return config.apiUrl;
}
