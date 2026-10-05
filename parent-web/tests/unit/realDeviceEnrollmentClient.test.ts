import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealDeviceEnrollmentClient } from '../../src/api/real/realDeviceEnrollmentClient';
import { DeviceEnrollmentError } from '../../src/api/deviceEnrollmentClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealDeviceEnrollmentClient', () => {
  const apiBaseUrl = 'https://api.example.test';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('bearer token attachment (verified backend contract: Authorization: Bearer <token>)', () => {
    it('createInvitation attaches the Authorization header from the injected token accessor', async () => {
      const client = new RealDeviceEnrollmentClient(apiBaseUrl, async () => 'raw-session-token-abc');
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          invitationId: 'inv-1',
          familyId: 'fam-1',
          platform: 'ANDROID',
          requestedProtectionMode: 'ANDROID_STANDARD',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:15:00.000Z',
          openedAt: null,
          redeemedAt: null,
          revokedAt: null,
          rawInvitationToken: 'raw-invite-token-xyz',
        }),
      );
      const result = await client.createInvitation('fam-1', {
        platform: 'ANDROID',
        requestedProtectionMode: 'ANDROID_STANDARD',
      }, 'fresh-create-grant');
      expect(result.rawInvitationToken).toBe('raw-invite-token-xyz');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/invitations`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer raw-session-token-abc');
      expect(JSON.parse(init.body as string)).toEqual({ platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD', stepUpToken: 'fresh-create-grant' });
    });

    it('fails fast with SERVICE_SESSION_UNAVAILABLE when no bearer token is available, without ever calling fetch', async () => {
      const client = new RealDeviceEnrollmentClient(apiBaseUrl, async () => null);
      await expect(
        client.createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the default constructor (no token accessor, no cookie mode) also honestly rejects rather than silently omitting the header', async () => {
      const client = new RealDeviceEnrollmentClient(apiBaseUrl);
      await expect(client.listInvitations('fam-1')).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // backend/src/auth/fastifyAuthPlugin.ts's createRequireServiceSession
  // accepts EITHER the Bearer header OR the `pca_family_session` HttpOnly
  // cookie (and, for non-GET, the double-submit CSRF header named in
  // backend/src/parentaccount/cookies.ts). This client used to short-circuit
  // every browser call before fetch on the false premise that only Bearer
  // was accepted.
  describe('cookie-session transport (the browser wiring)', () => {
    const cookieClient = () => new RealDeviceEnrollmentClient(apiBaseUrl, undefined, true);
    const ceremonyDto = {
      ceremonyId: 'ceremony-1',
      deviceId: 'device-1',
      dskFingerprint: 'sha256:abc123',
      status: 'PENDING',
      createdAt: '2026-10-05T10:00:00.000Z',
      expiresAt: '2026-10-05T10:10:00.000Z',
      approvedAt: null,
    };

    beforeEach(() => {
      document.cookie = 'pca_family_csrf=; Max-Age=0; path=/';
    });

    afterEach(() => {
      document.cookie = 'pca_family_csrf=; Max-Age=0; path=/';
    });

    it('listInvitations genuinely calls the route with browser credentials and no bearer header', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, []));

      await cookieClient().listInvitations('fam-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/invitations`);
      expect(init.credentials).toBe('include');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      expect(headers['X-PCA-CSRF-Token']).toBeUndefined();
    });

    it('lists only the allowlisted first-device ceremony DTO through the family session cookie', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ceremonies: [ceremonyDto] }));

      await expect(cookieClient().listFirstDeviceBootstrapCeremonies('family/one')).resolves.toEqual([ceremonyDto]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/api/parent/families/family%2Fone/first-device-bootstrap`);
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it('rejects unexpected ceremony fields instead of propagating private metadata to Parent UI state', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {
        ceremonies: [{ ...ceremonyDto, dskPublicKey: 'must-not-be-here' }],
      }));

      await expect(cookieClient().listFirstDeviceBootstrapCeremonies('fam-1')).rejects.toMatchObject({ code: 'UNKNOWN' });
    });

    it('approves with the family-scoped route, double-submit CSRF and exact operation token', async () => {
      document.cookie = 'pca_family_csrf=csrf-approval; path=/';
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {
        ceremony: { ...ceremonyDto, status: 'APPROVED', approvedAt: '2026-10-05T10:01:00.000Z' },
      }));

      await expect(cookieClient().approveFirstDeviceBootstrap('fam-1', 'ceremony-1', 'operation-bound-token'))
        .resolves.toMatchObject({ status: 'APPROVED', ceremonyId: 'ceremony-1' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/api/parent/families/fam-1/first-device-bootstrap/approve`);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-approval');
      expect(JSON.parse(init.body as string)).toEqual({ ceremonyId: 'ceremony-1', stepUpToken: 'operation-bound-token' });
    });

    it('a mutating call sends the double-submit CSRF header carrying the pca_family_csrf cookie value', async () => {
      document.cookie = 'pca_family_csrf=csrf-token-value; path=/';
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          invitationId: 'inv-1',
          familyId: 'fam-1',
          platform: 'ANDROID',
          requestedProtectionMode: 'ANDROID_STANDARD',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:15:00.000Z',
          openedAt: null,
          redeemedAt: null,
          revokedAt: null,
          rawInvitationToken: 'raw-invite-token-xyz',
        }),
      );

      await cookieClient().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-token-value');
    });

    it('an authenticated-but-unauthorized caller now receives the server\'s own honest 403, not a client-side excuse', async () => {
      document.cookie = 'pca_family_csrf=csrf-token-value; path=/';
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden', code: 'MANAGED_DEVICE_LIMIT_REACHED' }));

      await expect(
        cookieClient().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', serverCode: 'MANAGED_DEVICE_LIMIT_REACHED', httpStatus: 403 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('endpoint mapping against the verified backend contract', () => {
    const client = () => new RealDeviceEnrollmentClient(apiBaseUrl, async () => 'tok');

    it('getInvitation calls GET /v1/families/:familyId/invitations/:invitationId', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          invitationId: 'inv-1',
          familyId: 'fam-1',
          platform: 'ANDROID',
          requestedProtectionMode: 'ANDROID_STANDARD',
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:15:00.000Z',
          openedAt: null,
          redeemedAt: null,
          revokedAt: null,
        }),
      );
      await client().getInvitation('fam-1', 'inv-1');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/invitations/inv-1`);
      expect(init.method).toBe('GET');
    });

    it('listInvitations calls GET /v1/families/:familyId/invitations', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
      await client().listInvitations('fam-1');
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/invitations`);
    });

    it('revokeInvitation calls POST /v1/families/:familyId/invitations/:invitationId/revoke', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          invitationId: 'inv-1',
          familyId: 'fam-1',
          platform: 'ANDROID',
          requestedProtectionMode: 'ANDROID_STANDARD',
          status: 'REVOKED',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:15:00.000Z',
          openedAt: null,
          redeemedAt: null,
          revokedAt: '2026-01-01T00:05:00.000Z',
        }),
      );
      const result = await client().revokeInvitation('fam-1', 'inv-1', 'step-up-token');
      expect(result.status).toBe('REVOKED');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/invitations/inv-1/revoke`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ stepUpToken: 'step-up-token' });
    });

    it('getPairingRequest calls GET /v1/families/:familyId/pairing-requests/:deviceId', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          deviceId: 'dev-1',
          platform: 'ANDROID',
          status: 'PAIRING_PENDING',
          dskFingerprint: null,
          dekFingerprint: null,
        }),
      );
      const result = await client().getPairingRequest('fam-1', 'dev-1');
      expect(result.dskFingerprint).toBeNull();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/pairing-requests/dev-1`);
      expect(init.method).toBe('GET');
    });

    it('confirmPairing calls POST /v1/families/:familyId/pairing-requests/:deviceId/confirm and resolves PAIRED', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          deviceId: 'dev-1',
          platform: 'ANDROID',
          status: 'PAIRED',
          dskFingerprint: 'aa:bb',
          dekFingerprint: 'cc:dd',
        }),
      );
      const result = await client().confirmPairing('fam-1', 'dev-1', 'step-up-token');
      expect(result.status).toBe('PAIRED');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/pairing-requests/dev-1/confirm`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ stepUpToken: 'step-up-token' }));
    });

    it('confirmPairing throws (defense-in-depth) if the server ever illegally returns ACTIVE', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          deviceId: 'dev-1',
          platform: 'ANDROID',
          status: 'ACTIVE',
          dskFingerprint: 'aa:bb',
          dekFingerprint: 'cc:dd',
        }),
      );
      await expect(client().confirmPairing('fam-1', 'dev-1', 'step-up-token')).rejects.toThrow(/ACTIVE/);
    });
  });

  describe('honest error-state mapping (never a silent fixture fallback)', () => {
    const client = () => new RealDeviceEnrollmentClient(apiBaseUrl, async () => 'tok');

    it('maps 401 to UNAUTHORIZED', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await expect(client().listInvitations('fam-1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('maps 403 to FORBIDDEN (a real RBAC rejection, not a client guess)', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(
        client().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', serverCode: null });
    });

    it('forwards the body\'s code on 403 so MANAGED_DEVICE_LIMIT_REACHED is distinguishable from a generic authority rejection', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden', code: 'MANAGED_DEVICE_LIMIT_REACHED' }));
      await expect(
        client().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', serverCode: 'MANAGED_DEVICE_LIMIT_REACHED' });
    });

    it('maps 404 to NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(client().getInvitation('fam-1', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('maps 409 to CONFLICT', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 409 }));
      await expect(client().confirmPairing('fam-1', 'dev-1', 'step-up-token')).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('maps 429 to RATE_LIMITED', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
      await expect(
        client().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('preserves the server release-readiness code on 503', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(503, {
        error: 'service_unavailable',
        code: 'PLATFORM_ENROLLMENT_UNAVAILABLE',
      }));
      await expect(
        client().createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' }, 'fresh-create-grant'),
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        serverCode: 'PLATFORM_ENROLLMENT_UNAVAILABLE',
        httpStatus: 503,
      });
    });

    it('maps a network failure (offline) to NETWORK_ERROR, not an unhandled rejection type', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(client().listInvitations('fam-1')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });

    it('an unrecognised status maps to UNKNOWN rather than being swallowed', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
      await expect(client().listInvitations('fam-1')).rejects.toBeInstanceOf(DeviceEnrollmentError);
    });
  });
});
