// Privacy-absence sentinel test for the browser console sink (FABLE-A057).
//
// A synthetic error object carries three sentinels a real failure could carry
// in production: a request URL, a child display name and a rejected domain.
// In a PRODUCTION build none of them may reach console.error; in a
// development build the raw object is passed through (developers need it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportDiagnostic } from '../../src/security/diagnosticConsole';

const SENTINEL_URL = 'https://api.example.invalid/v1/families/fam-SENTINEL-9f3c/children';
const SENTINEL_CHILD = 'Layla-SENTINEL-CHILD';
const SENTINEL_DOMAIN = 'blocked-SENTINEL-domain.example';

function sentinelError() {
  const error = new Error('request failed') as Error & { url: string; body: unknown };
  error.url = SENTINEL_URL;
  error.body = { childDisplayName: SENTINEL_CHILD, rule: { domain: SENTINEL_DOMAIN } };
  return error;
}

describe('reportDiagnostic (console privacy sink)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('PRODUCTION: logs only the label and the string detail -- no sentinel from the raw error object reaches the console', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportDiagnostic('[pca] async load failed:', 'Error: request failed', sentinelError());
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0], (_key, value) => (value instanceof Error ? { ...value, message: value.message } : value));
    expect(spy.mock.calls[0]).toHaveLength(2);
    for (const sentinel of [SENTINEL_URL, SENTINEL_CHILD, SENTINEL_DOMAIN, 'fam-SENTINEL-9f3c']) {
      expect(logged).not.toContain(sentinel);
    }
  });

  it('NEGATIVE CONTROL (development): the raw object IS passed through, proving the production assertion is not vacuous', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = sentinelError();
    reportDiagnostic('[pca] async load failed:', 'Error: request failed', raw);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(3);
    expect(spy.mock.calls[0][2]).toBe(raw);
  });
});
