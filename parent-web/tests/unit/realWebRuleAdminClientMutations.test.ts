// Proves RealWebRuleAdminClient.setRule/removeRule are genuinely real
// writes once trust + crypto-review both pass (previously hardcoded
// throws with zero payload-construction logic at all) -- they resolve the
// current family id, send the actor-device bearer token + CSRF header, POST
// a plain {domain, listType} JSON body to the real backend route
// (backend/src/http/routes/webRuleRoutes.ts), and parse the returned rule
// list -- while still only ever reporting PENDING_DELIVERY, never
// DELIVERED/APPLIED (doc 36: "parent saved != child applied"), because
// actual device delivery remains behind the separate, still-unresolved
// production family-envelope crypto gate (items D/E/G) this class does not
// attempt to solve.
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

const { RealWebRuleAdminClient } = await import('../../src/api/real/realWebRuleAdminClient');
type TrustedBrowserProviderType = import('../../src/domain/trustedBrowser').TrustedBrowserProvider;

const trustedBrowser = {
  getSnapshot: vi.fn(async () => ({
    state: 'TRUSTED' as const,
    serviceAuthenticated: true,
    browserEndpointId: 'endpoint-a',
    trustSetEpoch: 5,
    acceptedMinEpoch: 5,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
    actorDeviceSessionToken: 'actor-device-session-token',
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

describe('RealWebRuleAdminClient mutations (crypto gate mocked ready)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('setRule POSTs {domain, listType} with the actor-device bearer token, never a self-reported device id', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ rules: [{ domain: 'example.com', listType: 'DENY', createdAtUtc: '2026-01-07T09:00:00.000Z' }] }),
    }));

    const client = new RealWebRuleAdminClient('https://pca.example', trustedBrowser);
    const result = await client.setRule('child-1', 'example.com', 'DENY');

    expect(result).toEqual({
      rules: [{ domain: 'example.com', listType: 'DENY', createdAtUtc: '2026-01-07T09:00:00.000Z' }],
      status: 'PENDING_DELIVERY',
    });

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/web-rules') && !String(url).includes('/remove'));
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/api/parent/families/family-1/children/child-1/web-rules');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({ domain: 'example.com', listType: 'DENY' });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer actor-device-session-token');
  });

  it('removeRule POSTs to the /remove sub-path with {domain, listType}', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ rules: [] }),
    }));

    const client = new RealWebRuleAdminClient('https://pca.example', trustedBrowser);
    const result = await client.removeRule('child-1', 'example.com', 'DENY');

    expect(result).toEqual({ rules: [], status: 'PENDING_DELIVERY' });

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/web-rules/remove'));
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/api/parent/families/family-1/children/child-1/web-rules/remove');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ domain: 'example.com', listType: 'DENY' });
  });

  it('setRule surfaces a real HTTP failure rather than pretending to succeed', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }));
    void fetchMock;
    const client = new RealWebRuleAdminClient('https://pca.example', trustedBrowser);
    await expect(client.setRule('child-1', 'example.com', 'DENY')).rejects.toThrow(/403/);
  });

  it('setRule discards a malformed rule element from the response rather than fabricating a rule', async () => {
    stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({ rules: [{ domain: 'example.com', listType: 'DENY', createdAtUtc: '2026-01-07T09:00:00.000Z' }, { domain: 123, listType: 'DENY' }] }),
    }));
    const client = new RealWebRuleAdminClient('https://pca.example', trustedBrowser);
    const result = await client.setRule('child-1', 'example.com', 'DENY');
    expect(result.rules).toEqual([{ domain: 'example.com', listType: 'DENY', createdAtUtc: '2026-01-07T09:00:00.000Z' }]);
  });

  it('setRule still fails before any fetch when the browser is not trusted, even with crypto mocked ready', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const notTrustedBrowser = {
      getSnapshot: vi.fn(async () => ({
        state: 'BROWSER_NOT_TRUSTED' as const,
        serviceAuthenticated: true,
        browserEndpointId: 'endpoint-a',
        trustSetEpoch: 5,
        acceptedMinEpoch: 5,
        pairingRequestedAtUtc: null,
        lastFingerprint: null,
        actorDeviceSessionToken: null,
      })),
    } as unknown as TrustedBrowserProviderType;
    const client = new RealWebRuleAdminClient('https://pca.example', notTrustedBrowser);
    await expect(client.setRule('child-1', 'example.com', 'DENY')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
