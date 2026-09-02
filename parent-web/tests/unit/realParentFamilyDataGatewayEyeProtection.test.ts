// Proves RealParentFamilyDataGateway.updateEyeProtection is a genuinely
// real write (not a stub) once trust + crypto-review both pass: it calls
// the real backend/src/http/routes/eyeProtectionRoutes.ts endpoint
// directly with the actor-device bearer token and CSRF header, NOT the
// schedule-policy encrypted-envelope relay updateScreenTime/updateAppRule
// use (see realParentFamilyDataGateway.ts's own doc comment on this
// method for why).
import { afterEach, describe, expect, it, vi } from 'vitest';

// The crypto gate is a hardcoded, non-configurable `false` in source (see
// parent-sdk/browser-runtime/src/cryptoGate.ts's own header comment) --
// every real-mode test for a crypto-gated client must mock it explicitly to
// exercise anything past that gate (see realRequestClient.test.ts's own
// identical override). This does not touch production code: it only
// overrides the imported module's behavior for this test file.
vi.mock('@pca/parent-sdk-browser-runtime', async () => {
  const actual = await vi.importActual<typeof import('@pca/parent-sdk-browser-runtime')>('@pca/parent-sdk-browser-runtime');
  return { ...actual, getCryptoGateDecision: () => ({ status: 'READY' as const, reason: 'test override' }) };
});

const { RealParentFamilyDataGateway } = await import('../../src/api/real/realParentFamilyDataGateway');
const { createLocalFamilyDataStore } = await import('../../src/security/localFamilyDataStore');
type TrustedBrowserProviderType = import('../../src/domain/trustedBrowser').TrustedBrowserProvider;
type SchedulePolicyAuthoring = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyAuthoring;
type SchedulePolicyTransport = import('../../src/api/schedulePolicyAuthoring').SchedulePolicyTransport;

const trustedBrowser = {
  getSnapshot: vi.fn(async () => ({
    state: 'TRUSTED' as const,
    serviceAuthenticated: true,
    browserEndpointId: 'browser-1',
    trustSetEpoch: 4,
    acceptedMinEpoch: 4,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
    actorDeviceSessionToken: 'actor-device-session-token-1',
  })),
} as unknown as TrustedBrowserProviderType;

const noopAuthoring: SchedulePolicyAuthoring = { async encrypt() { throw new Error('not used by this test'); } };
const noopTransport: SchedulePolicyTransport = { async submit() { throw new Error('not used by this test'); } };

function stubFamilySessionAndFetch(fetchImpl: (input: unknown, init?: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/parent/session')) {
      return { ok: true, json: async () => ({ familyId: 'family-1' }) };
    }
    return fetchImpl(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function buildGateway(trustedBrowserOverride: TrustedBrowserProviderType = trustedBrowser) {
  return new RealParentFamilyDataGateway(trustedBrowserOverride, noopAuthoring, noopTransport, 'https://pca.example', createLocalFamilyDataStore());
}

describe('RealParentFamilyDataGateway.updateEyeProtection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the real eye-protection backend route with the actor device bearer token and CSRF header, never the schedule-policy relay', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ eyeProtection: { childProfileId: 'child-1', remindersEnabled: true, updatedAtUtc: '2026-01-01T00:00:00.000Z' } }),
    }));
    document.cookie = 'pca_family_csrf=csrf-token-1';

    const result = await buildGateway().updateEyeProtection('child-1', true);

    expect(result).toEqual({ remindersEnabled: true });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/eye-protection'));
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/api/parent/families/family-1/children/child-1/eye-protection');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer actor-device-session-token-1');
    expect(headers['X-PCA-CSRF-Token']).toBe('csrf-token-1');
    expect(JSON.parse(init.body as string)).toEqual({ remindersEnabled: true });
  });

  it('surfaces a real backend rejection (e.g. the trust-set-resolver external gate) as an honest error, never a silent success', async () => {
    stubFamilySessionAndFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }));

    await expect(buildGateway().updateEyeProtection('child-1', true)).rejects.toThrow(/403.*forbidden/);
  });

  it('refuses to call the backend when no verified actor device session token is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const noSessionToken = {
      getSnapshot: vi.fn(async () => ({ ...(await trustedBrowser.getSnapshot()), actorDeviceSessionToken: null })),
    } as unknown as TrustedBrowserProviderType;

    await expect(buildGateway(noSessionToken).updateEyeProtection('child-1', true)).rejects.toThrow('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call the backend when no family session is available', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/api/parent/session')) return { ok: false, status: 401 };
      throw new Error('should not reach the eye-protection endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildGateway().updateEyeProtection('child-1', true)).rejects.toThrow('no authenticated family session available');
  });
});
