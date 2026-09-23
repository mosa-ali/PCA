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

  it('getSession consumes the server-authoritative normal family role', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', emailVerified: true, role: 'ADMINISTRATOR' }));
    const session = await client.getSession();
    expect(session).toEqual({
      state: 'FAMILY_READY',
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'ADMINISTRATOR',
      serviceAuthenticated: true,
    });
  });

  it('getSession returns an EXPLICIT pre-family state (GENESIS_REQUIRED) for an unresolved family role -- it no longer rejects a legitimate authenticated pre-family response', async () => {
    // THIS TEST PREVIOUSLY ASSERTED THE DEFECT AS THE SPECIFICATION: it required
    // getSession() to REJECT `{familyId: null, role: null}` with
    // UNAUTHORIZED_FAMILY_SCOPE. But the backend deliberately allows a VERIFIED
    // identity before family genesis, and its own contract documents
    // "`familyId` may be null if genesis is not currently available" -- so the
    // old assertion demanded that a SUCCESS be reported as a failure. That is
    // exactly the shape this programme exists to remove.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true, role: null }));
    const session = await client.getSession();
    // genesisAvailable defaults to true when the server predates the additive
    // field (`!== false`, never truthiness) -- see the dedicated mapping tests.
    expect(session).toEqual({
      state: 'GENESIS_REQUIRED',
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: null,
      memberId: null,
      role: null,
      serviceAuthenticated: true,
      genesisAvailable: true,
    });
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
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', role: 'ADMINISTRATOR', sessionEstablished: true }));
    const session = await client.verifyEmail('parent@example.test', '123456');
    expect(session).toEqual({
      state: 'FAMILY_READY',
      accountId: 'acc-1',
      displayName: 'acc-1',
      familyId: 'fam-1',
      memberId: 'acc-1',
      role: 'ADMINISTRATOR',
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
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', role: 'ADMINISTRATOR', sessionEstablished: true }));
    const result = await client.signIn('parent@example.test', 'super-secret');
    if (result.status !== 'AUTHENTICATED') throw new Error('expected AUTHENTICATED');
    expect(result.session.accountId).toBe('acc-1');
    expect(result.session.role).toBe('ADMINISTRATOR');
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

  it('signIn returns STEP_UP_REQUIRED (never a fabricated session) when the backend reports sessionEstablished: false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { sessionEstablished: false, stepUpRequired: true }));
    const result = await client.signIn('parent@example.test', 'correct-password');
    expect(result).toEqual({ status: 'STEP_UP_REQUIRED' });
  });

  // ---------------------------------------------------------------------
  // POST /api/parent/login/step-up
  // ---------------------------------------------------------------------

  it('completeLoginStepUp posts email/code and returns the established session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: 'fam-1', role: 'ADMINISTRATOR', sessionEstablished: true }));
    const session = await client.completeLoginStepUp('parent@example.test', '123456');
    expect(session.accountId).toBe('acc-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/api/parent/login/step-up`);
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'parent@example.test', code: '123456' });
  });

  it('completeLoginStepUp surfaces INVALID_CREDENTIALS on 401 (wrong/expired code)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_code' }));
    await expect(client.completeLoginStepUp('parent@example.test', '000000')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('completeLoginStepUp surfaces RATE_LIMITED on 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
    await expect(client.completeLoginStepUp('parent@example.test', '000000')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
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
  // GENESIS transports -- the honest failure contract (F-A-min, W4).
  //
  // These construct REAL Response objects with the exact statuses the backend
  // returns, rather than mocking this client's own mapping: a test that mocks
  // the mapper can pass while the mapper is wrong.
  // ---------------------------------------------------------------------

  const COMPLETION_INPUT = {
    challengeId: 'challenge-1',
    proofSignature: 'proof-signature',
    anchorSignature: 'anchor-signature',
    attestationSignature: 'attestation-signature',
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
  };

  const GENESIS_MATRIX = [
    {
      name: 'startGenesisStepUp',
      call: () => client.startGenesisStepUp('parent@example.test', 'correct-horse-battery'),
      cases: [
        [400, 'INVALID_REQUEST'],
        [401, 'INVALID_CREDENTIALS'],
        [403, 'INVALID_REQUEST'],
        [429, 'RATE_LIMITED'],
        [500, 'UNKNOWN'],
        [503, 'NOT_IMPLEMENTED'],
      ],
    },
    {
      name: 'completeGenesisStepUp',
      call: () => client.completeGenesisStepUp('123456'),
      cases: [
        [400, 'INVALID_REQUEST'],
        [401, 'INVALID_CREDENTIALS'],
        [403, 'INVALID_REQUEST'],
        [429, 'RATE_LIMITED'],
        [500, 'UNKNOWN'],
        [503, 'NOT_IMPLEMENTED'],
      ],
    },
    {
      name: 'requestGenesisChallenge',
      call: () => client.requestGenesisChallenge('public-key', 'BROWSER'),
      cases: [
        [400, 'INVALID_REQUEST'],
        [401, 'SESSION_EXPIRED'],
        [403, 'INVALID_REQUEST'],
        [429, 'RATE_LIMITED'],
        [500, 'UNKNOWN'],
        [503, 'NOT_IMPLEMENTED'],
      ],
    },
    {
      name: 'completeGenesis',
      call: () => client.completeGenesis(COMPLETION_INPUT),
      cases: [
        [400, 'GENESIS_REJECTED'],
        [401, 'SESSION_EXPIRED'],
        [403, 'INVALID_REQUEST'],
        [429, 'RATE_LIMITED'],
        [500, 'UNKNOWN'],
        [503, 'NOT_IMPLEMENTED'],
      ],
    },
  ] as const;

  for (const method of GENESIS_MATRIX) {
    for (const [status, expectedCode] of method.cases) {
      it(`${method.name} maps ${status} to ${expectedCode}`, async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(status, { error: 'stub' }));
        await expect(method.call()).rejects.toMatchObject({ code: expectedCode });
      });
    }

    it(`${method.name} surfaces a transport failure as NETWORK_ERROR`, async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(method.call()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  }

  it('INVARIANT: completeGenesis maps a rejected genesis proof (400) to GENESIS_REJECTED -- NEVER SESSION_EXPIRED', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_genesis_proof' }));
    await expect(client.completeGenesis(COMPLETION_INPUT)).rejects.toMatchObject({ code: 'GENESIS_REJECTED' });
  });

  it('INVARIANT: completeGenesis maps unavailable genesis cryptography (503) to NOT_IMPLEMENTED -- the session is fine, the capability is absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'genesis_unavailable' }));
    await expect(client.completeGenesis(COMPLETION_INPUT)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  // ---------------------------------------------------------------------
  // GET /api/parent/session -- additive genesisAvailable signal (W1/B7)
  // ---------------------------------------------------------------------

  it('getSession maps genesisAvailable:false onto the GENESIS_REQUIRED session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true, role: null, genesisAvailable: false }));
    const session = await client.getSession();
    expect(session).toMatchObject({ state: 'GENESIS_REQUIRED', accountId: 'acc-1', genesisAvailable: false });
  });

  it('getSession treats an ABSENT genesisAvailable as available (a server that predates the field is never read as unavailable)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true, role: null }));
    const session = await client.getSession();
    expect(session).toMatchObject({ state: 'GENESIS_REQUIRED', genesisAvailable: true });
  });

  it('getSession keeps genesisAvailable:true when the deployment declares availability', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accountId: 'acc-1', familyId: null, emailVerified: true, role: null, genesisAvailable: true }));
    const session = await client.getSession();
    expect(session).toMatchObject({ state: 'GENESIS_REQUIRED', genesisAvailable: true });
  });

  // ---------------------------------------------------------------------
  // Network errors
  // ---------------------------------------------------------------------

  it('a network failure surfaces as NETWORK_ERROR, not an unhandled rejection type', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(client.getSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
