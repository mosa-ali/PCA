import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformAdminAuthClient, PlatformAdminApiError } from '../../src/api/platformAdminAuthClient';
import { secureSession } from '../../src/security/secureSession';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('platformAdminAuthClient', () => {
  beforeEach(() => {
    secureSession.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login() POSTs credentials and stores nothing itself (caller owns session storage)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sessionToken: 'tok', expiresAt: '2030-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await platformAdminAuthClient.login('owner@pca.test', 'hunter2', '123456');

    expect(result).toEqual({ sessionToken: 'tok', expiresAt: '2030-01-01T00:00:00Z' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/platform-admin/auth/login');
    expect(JSON.parse(init.body)).toEqual({ email: 'owner@pca.test', password: 'hunter2', totpCode: '123456' });
  });

  it('login() throws PlatformAdminApiError(401, "unauthorized") on bad credentials -- never distinguishes which factor failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));

    await expect(platformAdminAuthClient.login('x', 'y', '000000')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('login() surfaces a 429 rate-limit distinctly from a plain 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate_limited' })));

    const error = await platformAdminAuthClient.login('x', 'y', '000000').catch((e) => e);
    expect(error).toBeInstanceOf(PlatformAdminApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
  });

  it('whoami() sends the stored bearer token and parses the identity response', async () => {
    secureSession.set('tok-123', new Date(Date.now() + 60_000).toISOString());
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { adminId: 'admin-1', roles: ['APP_OWNER'], sessionExpiresAt: '2030-01-01T00:00:00Z' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const who = await platformAdminAuthClient.whoami();

    expect(who.adminId).toBe('admin-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('whoami() throws unauthorized immediately when no session token is stored, without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(platformAdminAuthClient.whoami()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stepUp() sends scope + totpCode and returns a fresh stepUpId', async () => {
    secureSession.set('tok-123', new Date(Date.now() + 60_000).toISOString());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { stepUpId: 'su-1', expiresAt: '2030-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await platformAdminAuthClient.stepUp('REFUND', '654321');

    expect(result.stepUpId).toBe('su-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ scope: 'REFUND', totpCode: '654321' });
  });

  it('a server 5xx never leaks response body detail beyond a generic code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Internal Server Error</html>', { status: 500 })));

    const error = await platformAdminAuthClient.login('x', 'y', '000000').catch((e) => e);
    expect(error.status).toBe(500);
    expect(error.code).toBe('server_error');
  });
});
