import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealTrustedBrowserProvider } from '../../src/api/real/realTrustedBrowserProvider';
import { hasLocalEndpointKey } from '../../src/security/trustedEndpointKeyStore';

const API_BASE_URL = 'https://api.example.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function urlOf(call: unknown[]): string {
  const input = call[0] as RequestInfo | URL;
  return typeof input === 'string' ? input : input.toString();
}

/** Mocks every leg of the real pairing ceremony as succeeding, so tests that only care about the resulting state don't need to repeat the full routing table. */
function mockFullPairingSuccess(overrides?: {
  familyId?: unknown;
  registerStatus?: number;
  registerBody?: unknown;
  challengeStatus?: number;
  challengeBody?: unknown;
  sessionStatus?: number;
  sessionBody?: unknown;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/parent/session')) {
      return Promise.resolve(jsonResponse(200, { familyId: overrides?.familyId ?? 'fam-1' }));
    }
    if (url.includes('/browser-endpoints')) {
      return Promise.resolve(
        jsonResponse(overrides?.registerStatus ?? 201, overrides?.registerBody ?? { deviceId: 'device-real-1', status: 'PAIRING_PENDING' }),
      );
    }
    if (url.includes('/challenge')) {
      return Promise.resolve(
        jsonResponse(overrides?.challengeStatus ?? 200, overrides?.challengeBody ?? { challengeId: 'chal-1', nonce: 'server-issued-nonce-value', expiresAt: '2026-01-01T00:00:00.000Z' }),
      );
    }
    if (url.includes('/session')) {
      return Promise.resolve(
        jsonResponse(overrides?.sessionStatus ?? 200, overrides?.sessionBody ?? { sessionToken: 'device-session-token-1', expiresAt: '2026-01-01T00:00:00.000Z' }),
      );
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Proves that service-login authentication and trusted-browser (endpoint)
 * authentication are genuinely separate states for the REAL provider, not
 * just the dev fixture -- see tests/unit/trustedBrowser.test.ts for the
 * equivalent dev-fixture coverage. This file exercises real WebCrypto key
 * generation (requestPairing) AND the real HTTP registration/device-session
 * ceremony against a mocked backend -- not a simulation.
 */
describe('RealTrustedBrowserProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'pca_family_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('starts BROWSER_NOT_TRUSTED with no service authentication', async () => {
    const provider = new RealTrustedBrowserProvider(API_BASE_URL);
    const snapshot = await provider.getSnapshot();
    expect(snapshot.state).toBe('BROWSER_NOT_TRUSTED');
    expect(snapshot.serviceAuthenticated).toBe(false);
  });

  it('service-login-authenticated != trusted-browser-authenticated: beginServiceAuthentication flips serviceAuthenticated but never reaches TRUSTED', async () => {
    const provider = new RealTrustedBrowserProvider(API_BASE_URL);
    const afterAuth = await provider.beginServiceAuthentication();
    expect(afterAuth.serviceAuthenticated).toBe(true);
    expect(afterAuth.state).toBe('PAIRING_REQUIRED');
    expect(afterAuth.state).not.toBe('TRUSTED');
  });

  describe('requestPairing', () => {
    it('performs real WebCrypto key generation, registers with the backend for a REAL server-issued deviceId (never a fabricated UUID), and only reaches PAIRING_PENDING', async () => {
      const fetchMock = mockFullPairingSuccess();
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      const pending = await provider.requestPairing();

      expect(pending.state).toBe('PAIRING_PENDING');
      expect(pending.state).not.toBe('TRUSTED');
      expect(pending.browserEndpointId).toBe('device-real-1');
      expect(pending.lastFingerprint).toBeTruthy();
      // A real, non-extractable signing key now genuinely exists in memory --
      // this is not a simulated/fixture fingerprint string.
      expect(hasLocalEndpointKey()).toBe(true);

      const registerCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/browser-endpoints'));
      expect(registerCall).toBeDefined();
      const [url, init] = registerCall as [string, RequestInit];
      expect(url).toBe('https://api.example.test/v1/families/fam-1/browser-endpoints');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
    });

    it('sends the real generated public key -- a base64url SEC1 uncompressed EC point decoding to 65 bytes, never a fingerprint or other stand-in -- with the CSRF header attached', async () => {
      document.cookie = 'pca_family_csrf=csrf-token-1';
      const fetchMock = mockFullPairingSuccess();
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      const pending = await provider.requestPairing();

      const registerCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/browser-endpoints'));
      const [, init] = registerCall as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-PCA-CSRF-Token']).toBe('csrf-token-1');

      const body = JSON.parse(init.body as string) as { dskPublicKey: string };
      expect(body.dskPublicKey).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(body.dskPublicKey).not.toBe(pending.lastFingerprint); // never sends the fingerprint as the key
      const decoded = atob(body.dskPublicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(body.dskPublicKey.length / 4) * 4, '='));
      expect(decoded.length).toBe(65); // 0x04 || x(32) || y(32)
      expect(decoded.charCodeAt(0)).toBe(0x04);
    });

    it('completes the real challenge/session device ceremony and populates actorDeviceSessionToken with the server-issued token', async () => {
      const fetchMock = mockFullPairingSuccess();
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      const pending = await provider.requestPairing();

      expect(pending.actorDeviceSessionToken).toBe('device-session-token-1');
      const challengeCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/challenge'));
      expect(urlOf(challengeCall as unknown[])).toBe('https://api.example.test/v1/runtime-sync/devices/device-real-1/challenge');
      const sessionCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/runtime-sync/devices/device-real-1/session'));
      expect(sessionCall).toBeDefined();
      const [, sessionInit] = sessionCall as [string, RequestInit];
      const sessionBody = JSON.parse(sessionInit.body as string) as { challengeId: string; signature: string };
      expect(sessionBody.challengeId).toBe('chal-1');
      expect(sessionBody.signature).toMatch(/^[A-Za-z0-9_-]+$/); // real ECDSA signature, base64url-encoded
    });

    it('never blocks reaching PAIRING_PENDING when the device-session ceremony is rejected (e.g. the pending-review signature verifier) -- actorDeviceSessionToken honestly stays null, never fabricated', async () => {
      const fetchMock = mockFullPairingSuccess({ sessionStatus: 401, sessionBody: { error: 'unauthorized' } });
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      const pending = await provider.requestPairing();

      expect(pending.state).toBe('PAIRING_PENDING');
      expect(pending.browserEndpointId).toBe('device-real-1');
      expect(pending.actorDeviceSessionToken).toBeNull();
      expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/session'))).toBe(true);
    });

    it('also stays PAIRING_PENDING with a null actorDeviceSessionToken when the challenge endpoint itself fails', async () => {
      mockFullPairingSuccess({ challengeStatus: 500, challengeBody: { error: 'internal' } });
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      const pending = await provider.requestPairing();

      expect(pending.state).toBe('PAIRING_PENDING');
      expect(pending.actorDeviceSessionToken).toBeNull();
    });

    it('rejects with a clear error, never fabricating a deviceId, when registration fails', async () => {
      const fetchMock = mockFullPairingSuccess({ registerStatus: 409, registerBody: { error: 'conflict' } });
      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      await expect(provider.requestPairing()).rejects.toThrow(/registration failed/);
      const snapshot = await provider.getSnapshot();
      expect(snapshot.state).toBe('PAIRING_REQUIRED');
      expect(snapshot.browserEndpointId).toBeNull();
      expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/challenge'))).toBe(false);
    });

    it('fails fast with FAMILY_SESSION_UNAVAILABLE, never calling the registration endpoint, when no family session is available', async () => {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(401, {}));
        return Promise.resolve(jsonResponse(404, {}));
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new RealTrustedBrowserProvider(API_BASE_URL);
      await provider.beginServiceAuthentication();
      await expect(provider.requestPairing()).rejects.toThrow('FAMILY_SESSION_UNAVAILABLE');
      expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/browser-endpoints'))).toBe(false);
    });
  });

  it('cannot fabricate TRUSTED status locally: simulateParentApproval honestly rejects (PAIRED is a separate, already-real route this class never calls itself)', async () => {
    mockFullPairingSuccess();
    const provider = new RealTrustedBrowserProvider(API_BASE_URL);
    await provider.beginServiceAuthentication();
    await provider.requestPairing();
    await expect(provider.simulateParentApproval()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    const snapshot = await provider.getSnapshot();
    expect(snapshot.state).toBe('PAIRING_PENDING');
    expect(snapshot.state).not.toBe('TRUSTED');
  });

  it('reset() clears the in-memory endpoint key and returns to BROWSER_NOT_TRUSTED', async () => {
    mockFullPairingSuccess();
    const provider = new RealTrustedBrowserProvider(API_BASE_URL);
    await provider.beginServiceAuthentication();
    await provider.requestPairing();
    expect(hasLocalEndpointKey()).toBe(true);
    const reset = await provider.reset();
    expect(reset.state).toBe('BROWSER_NOT_TRUSTED');
    expect(hasLocalEndpointKey()).toBe(false);
  });
});
