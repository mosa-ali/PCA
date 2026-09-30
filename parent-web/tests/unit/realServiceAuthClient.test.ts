import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealServiceAuthClient, ServiceAuthError } from '../../src/api/real/realServiceAuthClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ACTIVE = { status: 'ACTIVE' } as const;
const GRACE = { status: 'GRACE', graceExpiresAt: '2026-09-27T00:00:00.000Z' } as const;

function sessionBody(overrides: Record<string, unknown> = {}) {
  return { accountId: 'acc-1', familyId: 'fam-1', role: 'ADMINISTRATOR', mfa: ACTIVE, sessionEstablished: true, ...overrides };
}

function clearCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

describe('RealServiceAuthClient', () => {
  const apiBaseUrl = 'https://api.example.test';
  let client: RealServiceAuthClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new RealServiceAuthClient(apiBaseUrl);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    clearCookie('pca_family_csrf');
    document.cookie = 'pca_family_csrf=csrf-token-value';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearCookie('pca_family_csrf');
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

  it('getSession consumes the server-authoritative role and the authenticator status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'ADMINISTRATOR', mfa: GRACE }));
    const session = await client.getSession();
    expect(session).toEqual({
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'ADMINISTRATOR',
      serviceAuthenticated: true,
      mfa: GRACE,
    });
  });

  it('getSession maps ACTIVE and GRACE authenticator states', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'VIEWER', mfa: ACTIVE }));
    expect((await client.getSession())?.mfa).toEqual(ACTIVE);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'VIEWER', mfa: GRACE }));
    expect((await client.getSession())?.mfa).toEqual(GRACE);
  });

  it('getSession fails closed on a body without a family or role (no pre-family state exists any more)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true, role: null, mfa: ACTIVE }));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'UNAUTHORIZED_FAMILY_SCOPE' });
  });

  it('getSession fails closed on a missing or malformed authenticator status rather than guessing one', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'VIEWER' }));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'UNKNOWN' });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'VIEWER', mfa: { status: 'GRACE' } }));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'UNKNOWN' });
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
  // POST /api/parent/verify-email -- activates, establishes NO session
  // ---------------------------------------------------------------------

  it('verifyEmail posts email/code and reports VERIFIED without claiming a session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'VERIFIED', sessionEstablished: false }));
    const result = await client.verifyEmail('parent@example.test', '123456');
    expect(result).toEqual({ status: 'VERIFIED' });
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
    fetchMock.mockResolvedValueOnce(jsonResponse(200, sessionBody()));
    const result = await client.signIn('parent@example.test', 'super-secret');
    if (result.status !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');
    expect(result.session.accountId).toBe('acc-1');
    expect(result.session.role).toBe('ADMINISTRATOR');
    expect(result.session.mfa).toEqual(ACTIVE);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    // No totpCode key at all on the first call.
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'super-secret' });
    expect(JSON.stringify(client)).not.toContain('super-secret');
  });

  it('signIn returns MFA_REQUIRED for an account with an authenticator, then re-submits the SAME email+password with totpCode', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sessionEstablished: false, mfaRequired: true }));
    expect(await client.signIn('parent@example.test', 'pw')).toEqual({ status: 'MFA_REQUIRED' });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, sessionBody()));
    const result = await client.signIn('parent@example.test', 'pw', '123456');
    expect(result.status).toBe('AUTHENTICATED');
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/login`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'pw', totpCode: '123456' });
  });

  it('signIn distinguishes a wrong authenticator code (401 invalid_mfa_code) from wrong credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_mfa_code' }));
    await expect(client.signIn('parent@example.test', 'pw', '000000')).rejects.toMatchObject({ code: 'INVALID_MFA_CODE' });
  });

  it('signIn surfaces the SAME generic INVALID_CREDENTIALS error for every credential failure (401)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_credentials' }));
    await expect(client.signIn('parent@example.test', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    } satisfies Partial<ServiceAuthError>);
  });

  it('signIn maps the server-confirmed password lock to its safe recovery message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'password_login_locked' }));
    await expect(client.signIn('parent@example.test', 'correct-password')).rejects.toMatchObject({
      code: 'PASSWORD_LOGIN_LOCKED',
      message: expect.stringContaining('reset your password now'),
    });
  });

  it('signIn distinguishes an authenticator lockout (429 mfa_locked) from ordinary rate limiting', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'mfa_locked' }));
    await expect(client.signIn('parent@example.test', 'pw', '123456')).rejects.toMatchObject({ code: 'MFA_LOCKED' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
    await expect(client.signIn('parent@example.test', 'x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('maps an unknown-browser email step-up response without establishing a session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sessionEstablished: false, stepUpRequired: true }));
    await expect(client.signIn('parent@example.test', 'correct-password')).resolves.toEqual({ status: 'EMAIL_OTP_REQUIRED' });
  });

  // ---------------------------------------------------------------------
  // Authenticator enrollment
  // ---------------------------------------------------------------------

  it('startMfaEnrollment posts email/password and returns the one-time URI and secret without keeping them', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-value';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { otpauthUri: 'otpauth://totp/PCA:x?secret=ABCD', secret: 'ABCD' }));
    const result = await client.startMfaEnrollment('parent@example.test', 'pw');
    expect(result).toEqual({ otpauthUri: 'otpauth://totp/PCA:x?secret=ABCD', secret: 'ABCD' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/enrollment/start`);
    expect(init.credentials).toBe('include');
    // Session path: CSRF echoed when its cookie exists.
    expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-token-value');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'pw' });
    expect(JSON.stringify(client)).not.toContain('ABCD');
  });

  it('fetches the host-only API CSRF cookie through the authenticated no-store endpoint', async () => {
    clearCookie('pca_family_csrf');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: 'server-issued-csrf-token-value-0123456789' }))
      .mockResolvedValueOnce(jsonResponse(200, { otpauthUri: 'otpauth://totp/PCA:x?secret=ABCD', secret: 'ABCD' }));
    await client.startMfaEnrollment('parent@example.test', 'pw');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${apiBaseUrl}/api/parent/csrf`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/enrollment/start`);
    expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('server-issued-csrf-token-value-0123456789');
  });

  it('startMfaEnrollment on the ticket path (no CSRF cookie) sends no CSRF header', async () => {
    clearCookie('pca_family_csrf');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { otpauthUri: 'otpauth://totp/PCA:x?secret=ABCD', secret: 'ABCD' }));
    await client.startMfaEnrollment('parent@example.test', 'pw');
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('X-PCA-CSRF-Token');
  });

  it('startMfaEnrollment maps 401 to INVALID_CREDENTIALS and 429 to RATE_LIMITED', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    await expect(client.startMfaEnrollment('parent@example.test', 'pw')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
    await expect(client.startMfaEnrollment('parent@example.test', 'pw')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('preserves a CSRF mismatch as a distinct setup error', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-value';
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'csrf_mismatch' }));
    await expect(client.startMfaEnrollment('parent@example.test', 'pw')).rejects.toMatchObject({ code: 'CSRF_FAILED' });
  });

  it('confirmMfaEnrollment reports whether the ticket path established a session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { enrolled: true, sessionEstablished: false }));
    expect(await client.confirmMfaEnrollment('parent@example.test', '123456')).toEqual({ sessionEstablished: false });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ...sessionBody(), enrolled: true }));
    expect(await client.confirmMfaEnrollment('parent@example.test', '123456')).toEqual({ sessionEstablished: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/enrollment/confirm`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', code: '123456' });
  });

  it('confirmMfaEnrollment maps a wrong code and a lockout distinctly', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_mfa_code' }));
    await expect(client.confirmMfaEnrollment('parent@example.test', '000000')).rejects.toMatchObject({ code: 'INVALID_MFA_CODE' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'mfa_locked' }));
    await expect(client.confirmMfaEnrollment('parent@example.test', '000000')).rejects.toMatchObject({ code: 'MFA_LOCKED' });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    await expect(client.confirmMfaEnrollment('parent@example.test', '000000')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  // ---------------------------------------------------------------------
  // Lost-authenticator recovery
  // ---------------------------------------------------------------------

  it('requestMfaRecovery resolves identically on 202 whatever the account state', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(202, { status: 'RECOVERY_CODE_SENT_IF_ELIGIBLE' }));
    await expect(client.requestMfaRecovery('parent@example.test', 'pw')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/recovery/request`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'pw' });
  });

  it('completeMfaRecovery posts email/password/code and maps a wrong code to INVALID_CREDENTIALS', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'MFA_SETUP_REQUIRED', mfaSetupRequired: true, sessionEstablished: false }));
    await expect(client.completeMfaRecovery('parent@example.test', 'pw', '123456')).resolves.toEqual({ status: 'MFA_SETUP_REQUIRED' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/recovery/complete`);
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', password: 'pw', code: '123456' });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'MFA_SETUP_REQUIRED', mfaSetupRequired: true, sessionEstablished: false }));
    await expect(client.completeMfaRecovery('parent@example.test', 'pw', '123456')).resolves.toEqual({ status: 'MFA_SETUP_REQUIRED' });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_code' }));
    await expect(client.completeMfaRecovery('parent@example.test', 'pw', '000000')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/mfa/step-up -- commercial step-up
  // ---------------------------------------------------------------------

  it('issueCommercialStepUp posts operation/code with the CSRF header and returns the single-use grant (201)', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-value';
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { stepUpToken: 'grant-1', operation: 'BILLING_CHECKOUT_CREATE', expiresAt: '2026-09-24T10:05:00.000Z' }));
    const grant = await client.issueCommercialStepUp('BILLING_CHECKOUT_CREATE', '123456');
    expect(grant).toEqual({ stepUpToken: 'grant-1', operation: 'BILLING_CHECKOUT_CREATE', expiresAt: '2026-09-24T10:05:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/step-up`);
    expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-token-value');
    expect(JSON.parse(init.body as string)).toEqual({ operation: 'BILLING_CHECKOUT_CREATE', code: '123456' });
  });

  it('issueSensitiveStepUp posts the exact sensitive operation and returns its account/family-bound grant', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-value';
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { stepUpToken: 'sensitive-grant-1', operation: 'family.retention.update', expiresAt: '2026-09-26T10:05:00.000Z' }));
    await expect(client.issueSensitiveStepUp('family.retention.update', '123456')).resolves.toEqual({
      stepUpToken: 'sensitive-grant-1', operation: 'family.retention.update', expiresAt: '2026-09-26T10:05:00.000Z',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/mfa/step-up`);
    expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-token-value');
    expect(JSON.parse(init.body as string)).toEqual({ operation: 'family.retention.update', code: '123456' });
  });

  it('issueCommercialStepUp rejects a grant minted for a different operation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { stepUpToken: 'grant-1', operation: 'FAMILY_COMMERCIAL_REQUEST_CANCEL', expiresAt: '2026-09-24T10:05:00.000Z' }));
    await expect(client.issueCommercialStepUp('BILLING_CHECKOUT_CREATE', '123456')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('issueCommercialStepUp maps 403 forbidden, 401 invalid_mfa_code and 429 mfa_locked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));
    await expect(client.issueCommercialStepUp('FAMILY_COMMERCIAL_REQUEST_CREATE', '123456')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_mfa_code' }));
    await expect(client.issueCommercialStepUp('FAMILY_COMMERCIAL_REQUEST_CREATE', '000000')).rejects.toMatchObject({ code: 'INVALID_MFA_CODE' });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'mfa_locked' }));
    await expect(client.issueCommercialStepUp('FAMILY_COMMERCIAL_REQUEST_CREATE', '000000')).rejects.toMatchObject({ code: 'MFA_LOCKED' });
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

  it('revokeAllSessions calls the CSRF-protected endpoint with the HttpOnly session cookie attached', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await client.revokeAllSessions();
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBaseUrl}/api/parent/sessions/revoke-all`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-PCA-CSRF-Token': 'csrf-token-value' },
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init)).not.toMatch(/pca_family_session/);
  });

  it('revokeAllSessions reports expired sessions and CSRF rejection without claiming success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));
    await expect(client.revokeAllSessions()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'csrf_mismatch' }));
    await expect(client.revokeAllSessions()).rejects.toMatchObject({ code: 'CSRF_FAILED' });
  });

  // ---------------------------------------------------------------------
  // stepUp -- generic family-action step-up has no route
  // ---------------------------------------------------------------------

  it('stepUp never grants (no generic step-up route exists) and never calls fetch', async () => {
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
