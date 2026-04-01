import { getWebAppConfig, MissingApiUrlError, requireApiUrl } from './config';

describe('web config', () => {
  it('returns trimmed api url without trailing slash', () => {
    expect(
      getWebAppConfig({ NEXT_PUBLIC_API_URL: 'http://localhost:3001/api/' } as NodeJS.ProcessEnv),
    ).toEqual({
      apiUrl: 'http://localhost:3001/api',
    });
  });

  it('throws a predictable error when api url is missing', () => {
    expect(() => requireApiUrl({ apiUrl: null })).toThrow(MissingApiUrlError);
  });
});
