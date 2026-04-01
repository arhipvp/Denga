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

export function getWebAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebAppConfig {
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();

  return {
    apiUrl: apiUrl ? apiUrl.replace(/\/+$/, '') : null,
  };
}

export function requireApiUrl(config = getWebAppConfig()): string {
  if (!config.apiUrl) {
    throw new MissingApiUrlError();
  }

  return config.apiUrl;
}
