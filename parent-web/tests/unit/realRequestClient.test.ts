import { afterEach, describe, expect, it, vi } from 'vitest';

// The crypto gate is a hardcoded, non-configurable `false` in source (see
// parent-sdk/browser-runtime/src/cryptoGate.ts's own header comment) --
// every real-mode test for a crypto-gated client must mock it explicitly to
// exercise anything past that gate. This does not touch production code:
// it only overrides the imported module's behavior for this test file.
vi.mock('@pca/parent-sdk-browser-runtime', async () => {
  const actual = await vi.importActual<typeof import('@pca/parent-sdk-browser-runtime')>('@pca/parent-sdk-browser-runtime');
  return { ...actual, getCryptoGateDecision: () => ({ status: 'READY' as const, reason: 'test override' }) };
});

const { RealRequestClient } = await import('../../src/api/real/realRequestClient');
type TrustedBrowserProviderType = import('../../src/domain/trustedBrowser').TrustedBrowserProvider;

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

describe('RealRequestClient decide/grantBonusTime', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decide() posts to the real backend route with the actor device bearer token, never a self-reported header', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ request: { requestId: 'req-1', decisionActionId: 'audit-1' } }),
    }));

    const result = await new RealRequestClient('https://pca.example', trustedBrowser).decide('req-1', 'APPROVED');

    expect(result).toEqual({ auditEventId: 'audit-1' });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/child-requests/req-1/decide'));
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/api/parent/families/family-1/child-requests/req-1/decide');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer actor-device-session-token-1');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'APPROVED' });
  });

  it('decide() sends counterOfferExtraMinutes only for a COUNTERED decision', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ request: { requestId: 'req-1', decisionActionId: 'audit-2' } }),
    }));

    await new RealRequestClient('https://pca.example', trustedBrowser).decide('req-1', 'COUNTERED', 15);

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/decide'));
    const [, init] = call as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'COUNTERED', counterOfferExtraMinutes: 15 });
  });

  it('grantBonusTime() posts to the proactive-grant route and returns the new requestId', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ request: { requestId: 'req-2', decisionActionId: 'audit-3' } }),
    }));

    const result = await new RealRequestClient('https://pca.example', trustedBrowser).grantBonusTime('child-1', 20);

    expect(result).toEqual({ auditEventId: 'audit-3', requestId: 'req-2' });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/bonus-time/grant'));
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/api/parent/families/family-1/bonus-time/grant');
    expect(JSON.parse(init.body as string)).toEqual({ childProfileId: 'child-1', extraMinutes: 20 });
  });

  it('surfaces a real backend rejection (e.g. the trust-set-resolver external gate) as an honest error, never a silent success', async () => {
    stubFamilySessionAndFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: 'not_authorized_to_decide' }) }));

    await expect(new RealRequestClient('https://pca.example', trustedBrowser).decide('req-1', 'APPROVED'))
      .rejects.toThrow(/403.*not_authorized_to_decide/);
  });

  it('refuses to call the backend when no verified actor device session token is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const noSessionToken = {
      getSnapshot: vi.fn(async () => ({ ...(await trustedBrowser.getSnapshot()), actorDeviceSessionToken: null })),
    } as unknown as TrustedBrowserProviderType;

    await expect(new RealRequestClient('https://pca.example', noSessionToken).decide('req-1', 'APPROVED'))
      .rejects.toThrow('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call the backend when no family session is available', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/api/parent/session')) return { ok: false, status: 401 };
      throw new Error('should not reach the child-requests endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RealRequestClient('https://pca.example', trustedBrowser).grantBonusTime('child-1', 20))
      .rejects.toThrow('no family session is available');
  });
});
