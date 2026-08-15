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
    document.cookie = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------
  // GET /api/parent/session
  // ---------------------------------------------------------------------

  it('getSession returns null on 401 (no session), never throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    const session = await client.getSession();
    expect(session).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`${apiBaseUrl}/api/parent/session`, expect.objectContaining({ credentials: 'include' }));
  });

  it('getSession maps the real FAMILY_SERVICE_SESSION_V1 response shape ({accountId, familyId, emailVerified}) onto AuthenticatedSession', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true }));
    const session = await client.getSession();
    expect(session).toEqual({
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'OWNER',
      serviceAuthenticated: true,
    });
  });

  it('getSession treats a null familyId (genesis unavailable) as VIEWER, never fabricates OWNER', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true }));
    const session = await client.getSession();
    expect(session?.role).toBe('VIEWER');
    expect(session?.familyId).toBe('');
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/register
  // ---------------------------------------------------------------------

  it('register posts email/password/passwordConfirmation and returns the identical PENDING_VERIFICATION result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { status: 'PENDING_VERIFICATION' }));
    const result = await client.register('parent@example.test', 'a genuinely long password', 'a genuinely long password');
    expect(result).toEqual({ status: 'PENDING_VERIFICATION' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/register`);
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'parent@example.test',
      password: 'a genuinely long password',
      passwordConfirmation: 'a genuinely long password',
    });
  });

  it('register surfaces RATE_LIMITED on 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
    await expect(client.register('parent@example.test', 'x', 'x')).rejects.toMatchObject({ code: 'RATE_LIMITED' } satisfies Partial<ServiceAuthError>);
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/verify-email
  // ---------------------------------------------------------------------

  it('verifyEmail posts email/code and, on success, establishes the session (sessionEstablished response shape)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', sessionEstablished: true }));
    const session = await client.verifyEmail('parent@example.test', '123456');
    expect(session).toEqual({
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'OWNER',
      serviceAuthenticated: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/verify-email`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', code: '123456' });
  });

  it('verifyEmail surfaces INVALID_CREDENTIALS (wrong/expired code) on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_code' }));
    await expect(client.verifyEmail('parent@example.test', '000000')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/login
  // ---------------------------------------------------------------------

  it('signIn sends credentials only in the request body and never persists them', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', sessionEstablished: true }));
    const session = await client.signIn('parent@example.test', 'super-secret');
    expect(session.accountId).toBe('acc-1');
    // Ordinary sign-in gives no server-side role signal (see this file's
    // header) -- least-privilege placeholder, never a fabricated OWNER.
    expect(session.role).toBe('VIEWER');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'super-secret' });
    // Nothing on the client instance retains the password.
    expect(JSON.stringify(client)).not.toContain('super-secret');
  });

  it('signIn surfaces the SAME generic INVALID_CREDENTIALS error for every failure mode (401), never distinguishing wrong-password from unknown-email from unverified-account', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }));
    await expect(client.signIn('parent@example.test', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    } satisfies Partial<ServiceAuthError>);
  });

  it('signIn surfaces RATE_LIMITED on 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
    await expect(client.signIn('parent@example.test', 'x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/logout -- CSRF double-submit
  // ---------------------------------------------------------------------

  it('signOut calls the logout endpoint with credentials included and echoes the CSRF cookie as a header when present', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-value';
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.signOut();
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/parent/logout`,
      expect.objectContaining({ method: 'POST', credentials: 'include', headers: { 'X-PCA-CSRF-Token': 'csrf-token-value' } }),
    );
  });

  it('signOut never sends a bearer/session token in a header or body -- HttpOnly cookies are structurally unreadable from this client', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.signOut();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init)).not.toMatch(/pca_family_session/);
  });

  // ---------------------------------------------------------------------
  // stepUp -- honestly not implemented by FAMILY_SERVICE_SESSION_V1 this round
  // ---------------------------------------------------------------------

  it('stepUp never grants (no step-up route exists in this contract) and never calls fetch', async () => {
    const result = await client.stepUp('EXPORT_DATA');
    expect(result.granted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Network errors
  // ---------------------------------------------------------------------

  it('a network failure surfaces as NETWORK_ERROR, not an unhandled rejection type', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
