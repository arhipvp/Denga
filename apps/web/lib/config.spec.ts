import { getWebAppConfig, MissingApiUrlError, requireApiUrl } from './config';

describe('web config', () => {
  it('returns trimmed api url without trailing slash', () => {
    expect(getWebAppConfig('http://localhost:3001/api/')).toEqual({
      apiUrl: 'http://localhost:3001/api',
    });
  });

  it('returns null config when api url is empty', () => {
    expect(getWebAppConfig('')).toEqual({
      apiUrl: null,
    });
  });

  it('throws a predictable error when api url is missing', () => {
    expect(() => requireApiUrl({ apiUrl: null })).toThrow(MissingApiUrlError);
  });
});
