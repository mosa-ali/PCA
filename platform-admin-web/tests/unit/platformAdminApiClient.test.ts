import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for the same-origin-by-default fix to
 * src/config/env.ts / src/api/platformAdminApiClient.ts: this app has no
 * CORS layer (see vite.config.ts's header), so every request MUST resolve
 * against whatever origin this app itself is served from unless an operator
 * explicitly opts into an absolute override. A previous version of
 * config.apiBaseUrl defaulted to an absolute `http://localhost:4001`, which
 * silently broke this whenever the app was served from any other origin
 * (the normal case) -- confirmed by direct reproduction against a real
 * backend + MySQL (see e2e-real/realBackend.spec.ts's header).
 *
 * Both env.ts and platformAdminApiClient.ts read import.meta.env / a
 * module-level singleton at import time, so each case here stubs the env
 * var BEFORE a fresh dynamic import (vi.resetModules()) -- reusing the
 * top-level import would only ever observe whichever value was current the
 * first time the module was ever loaded in this test file.
 */
describe('platformAdminApiClient / config.apiBaseUrl: same-origin default', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshClientWithSession() {
    const { secureSession } = await import('../../src/security/secureSession');
    secureSession.set('tok-123', new Date(Date.now() + 60_000).toISOString());
    const { platformAdminApi } = await import('../../src/api/platformAdminApiClient');
    return platformAdminApi;
  }

  it('with VITE_PCA_PLATFORM_ADMIN_API_BASE_URL unset, requests resolve against THIS app\'s own origin -- never a hardcoded absolute backend URL', async () => {
    vi.stubEnv('VITE_PCA_PLATFORM_ADMIN_API_BASE_URL', '');
    vi.resetModules();
    const platformAdminApi = await freshClientWithSession();

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await platformAdminApi.get('/platform-admin/admin-users');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(url).toContain('/platform-admin/admin-users');
    // The old, broken default -- must never resurface silently.
    expect(url).not.toContain('localhost:4001');
  });

  it('an explicit absolute VITE_PCA_PLATFORM_ADMIN_API_BASE_URL override still resolves against that origin (opt-in split-origin deployment)', async () => {
    vi.stubEnv('VITE_PCA_PLATFORM_ADMIN_API_BASE_URL', 'https://admin-api.example.test');
    vi.resetModules();
    const platformAdminApi = await freshClientWithSession();

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await platformAdminApi.get('/platform-admin/admin-users');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith('https://admin-api.example.test/platform-admin/admin-users')).toBe(true);
  });
});
