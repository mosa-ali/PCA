// Proves RealWebRuleAdminClient's default (unmocked) behavior: the
// trusted-browser/crypto gate is a hardcoded, non-configurable `false` in
// source today (parent-sdk/browser-runtime/src/cryptoGate.ts), so every
// method here must fail closed BEFORE constructing or sending any request
// -- listRules, setRule and removeRule alike. See
// realWebRuleAdminClientMutations.test.ts (which mocks the gate open) for
// coverage of the real payload-construction/HTTP-call mapping this session
// added to setRule/removeRule.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealWebRuleAdminClient } from '../../src/api/real/realWebRuleAdminClient';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';

const TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  state: 'TRUSTED',
  serviceAuthenticated: true,
  browserEndpointId: 'endpoint-a',
  trustSetEpoch: 5,
  acceptedMinEpoch: 5,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
  actorDeviceSessionToken: 'actor-device-session-token',
};

class StubTrustedBrowserProvider implements TrustedBrowserProvider {
  constructor(private readonly snapshot: TrustedBrowserSnapshot) {}
  async getSnapshot() {
    return this.snapshot;
  }
  async beginServiceAuthentication() { return this.snapshot; }
  async requestPairing() { return this.snapshot; }
  async simulateParentApproval() { return this.snapshot; }
  async simulateEpochGoneStale() { return this.snapshot; }
  async simulateRevoke() { return this.snapshot; }
  async reset() { return this.snapshot; }
}

describe('RealWebRuleAdminClient (real crypto gate, not mocked)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listRules rejects before any fetch, even when trusted (crypto suite not yet approved)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.listRules('child-1')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('setRule rejects before any fetch, even when trusted (crypto suite not yet approved)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.setRule('child-1', 'example.com', 'DENY')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removeRule rejects before any fetch, even when trusted (crypto suite not yet approved)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.removeRule('child-1', 'example.com', 'DENY')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('setRule rejects before any fetch when the browser is not trusted either', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const notTrusted: TrustedBrowserSnapshot = { ...TRUSTED_SNAPSHOT, state: 'BROWSER_NOT_TRUSTED', actorDeviceSessionToken: null };
    const client = new RealWebRuleAdminClient('https://api.example.test', new StubTrustedBrowserProvider(notTrusted));
    await expect(client.setRule('child-1', 'example.com', 'DENY')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
