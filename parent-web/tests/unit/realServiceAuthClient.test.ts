import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealServiceAuthClient, ServiceAuthError } from '../../src/api/real/realServiceAuthClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealServiceAuthClient', () => {
  const apiBaseUrl = 'https://api.example.test';
  let client: RealServiceAuthClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new RealServiceAuthClient(apiBaseUrl);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSession returns null on 401 (no session), never throws', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const session = await client.getSession();
    expect(session).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/auth/session`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('getSession returns the session on 200', async () => {
    const fixtureSession = {
      accountId: 'acc-1',
      displayName: 'Real Parent',
      familyId: 'fam-1',
      memberId: 'mem-1',
      role: 'OWNER',
      serviceAuthenticated: true,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, fixtureSession));
    const session = await client.getSession();
    expect(session).toEqual(fixtureSession);
  });

  it('signIn sends credentials only in the request body and never persists them', async () => {
    const fixtureSession = {
      accountId: 'acc-1',
      displayName: 'Real Parent',
      familyId: 'fam-1',
      memberId: 'mem-1',
      role: 'OWNER',
      serviceAuthenticated: true,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, fixtureSession));
    const session = await client.signIn('parent@example.test', 'super-secret');
    expect(session).toEqual(fixtureSession);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'super-secret' });
    // Nothing on the client instance retains the password.
    expect(JSON.stringify(client)).not.toContain('super-secret');
  });

  it('signIn surfaces INVALID_CREDENTIALS on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(client.signIn('parent@example.test', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    } satisfies Partial<ServiceAuthError>);
  });

  it('signIn surfaces ACCOUNT_DISABLED on 403 without a recognised code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'disabled' }));
    await expect(client.signIn('parent@example.test', 'x')).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('signIn surfaces UNAUTHORIZED_FAMILY_SCOPE on 403 with that code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 'UNAUTHORIZED_FAMILY_SCOPE' }));
    await expect(client.signIn('parent@example.test', 'x')).rejects.toMatchObject({
      code: 'UNAUTHORIZED_FAMILY_SCOPE',
    });
  });

  it('stepUp surfaces SESSION_EXPIRED on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(client.stepUp('EXPORT_DATA')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('a network failure surfaces as NETWORK_ERROR, not an unhandled rejection type', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('signOut calls the logout endpoint with credentials included', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.signOut();
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/auth/logout`,
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
