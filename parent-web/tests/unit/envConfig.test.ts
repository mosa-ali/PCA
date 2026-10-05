import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveApiBaseUrl, resolveChildAppEnrollmentLinkBaseUrl } from '../../src/config/env';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Parent Web deployment-mode flag', () => {
  it('is true only for a production build that is not using demo mode', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_PCA_DEMO_MODE', 'false');
    vi.stubEnv('VITE_PCA_API_BASE_URL', 'https://api.pcasafe.com');
    vi.resetModules();
    const production = await import('../../src/config/env');
    expect(production.config.production).toBe(true);

    vi.stubEnv('VITE_PCA_DEMO_MODE', 'true');
    vi.resetModules();
    const productionDemo = await import('../../src/config/env');
    expect(productionDemo.config.production).toBe(false);

    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_PCA_DEMO_MODE', 'false');
    vi.resetModules();
    const development = await import('../../src/config/env');
    expect(development.config.production).toBe(false);
  });
});

describe('Child App production enrollment release gate', () => {
  it('is closed unless the build explicitly sets the readiness value to true', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_PCA_DEMO_MODE', 'false');
    vi.stubEnv('VITE_PCA_API_BASE_URL', 'https://api.pcasafe.com');
    vi.stubEnv('VITE_PCA_CHILD_APP_ENROLLMENT_READY', '');
    vi.resetModules();
    expect((await import('../../src/config/env')).config.childAppEnrollmentReady).toBe(false);

    vi.stubEnv('VITE_PCA_CHILD_APP_ENROLLMENT_READY', 'true');
    vi.resetModules();
    expect((await import('../../src/config/env')).config.childAppEnrollmentReady).toBe(true);

    vi.stubEnv('VITE_PCA_CHILD_APP_ENROLLMENT_READY', 'TRUE');
    vi.resetModules();
    expect((await import('../../src/config/env')).config.childAppEnrollmentReady).toBe(false);
  });
});

describe('Parent Web API build configuration', () => {
  it('preserves the local-development fallback when configuration is absent', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:4001');
    expect(resolveApiBaseUrl('   ', false)).toBe('http://localhost:4001');
  });

  it('continues to accept an explicitly configured local HTTP endpoint outside production', () => {
    expect(resolveApiBaseUrl('http://127.0.0.1:4001', false)).toBe('http://127.0.0.1:4001');
  });

  it('allows the explicit demo/test build path to retain its fixture-backed localhost endpoint', () => {
    expect(resolveApiBaseUrl('http://localhost:4001', false)).toBe('http://localhost:4001');
  });

  it('rejects a missing production API endpoint', () => {
    expect(() => resolveApiBaseUrl(undefined, true)).toThrow(/requires VITE_PCA_API_BASE_URL/);
    expect(() => resolveApiBaseUrl('  ', true)).toThrow(/requires VITE_PCA_API_BASE_URL/);
  });

  it('rejects HTTP in production even for a non-local hostname', () => {
    expect(() => resolveApiBaseUrl('http://api.pcasafe.com', true)).toThrow(/must use HTTPS/);
  });

  it.each([
    'https://localhost:4001',
    'https://api.localhost',
    'https://127.0.0.1:4001',
    'https://[::1]:4001',
    'https://0.0.0.0:4001',
  ])('rejects production loopback endpoint %s', (endpoint) => {
    expect(() => resolveApiBaseUrl(endpoint, true)).toThrow(/must not target localhost or a loopback address/);
  });

  it('accepts an explicit production HTTPS endpoint and removes trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.pcasafe.com///', true)).toBe('https://api.pcasafe.com');
  });
});

describe('Parent Web canonical Child App public-origin configuration', () => {
  it('keeps the local development enrollment link when nonproduction configuration is absent', () => {
    expect(resolveChildAppEnrollmentLinkBaseUrl(undefined, false)).toBe('http://localhost:4000/enroll');
  });

  it('does not invent a production public origin when configuration is absent', () => {
    expect(resolveChildAppEnrollmentLinkBaseUrl(undefined, true)).toBeNull();
    expect(resolveChildAppEnrollmentLinkBaseUrl('  ', true)).toBeNull();
  });

  it.each([
    'http://public.example.test',
    'https://localhost',
    'https://127.0.0.1',
    'https://user:password@public.example.test',
    'https://public.example.test/?token=unexpected',
    'https://public.example.test/#fragment',
    'https://public.example.test/enroll',
  ])('rejects unsafe production Child App public origin %s', (origin) => {
    expect(resolveChildAppEnrollmentLinkBaseUrl(origin, true)).toBeNull();
  });

  it('accepts the configured HTTPS public origin and appends the canonical enrollment route', () => {
    expect(resolveChildAppEnrollmentLinkBaseUrl('https://public.example.test/', true))
      .toBe('https://public.example.test/enroll');
  });

  it('normalizes the default HTTPS port and rejects nonstandard ports that Android App Links cannot match', () => {
    expect(resolveChildAppEnrollmentLinkBaseUrl('https://public.example.test:443', true))
      .toBe('https://public.example.test/enroll');
    expect(resolveChildAppEnrollmentLinkBaseUrl('https://public.example.test:8443', true)).toBeNull();
  });
});
