import { describe, expect, it } from 'vitest';
import { RealParentFamilyDataGateway } from '../../src/api/real/realParentFamilyDataGateway';
import { RealDeviceStatusClient } from '../../src/api/real/realDeviceStatusClient';
import { RealRequestClient } from '../../src/api/real/realRequestClient';
import { createLocalFamilyDataStore } from '../../src/security/localFamilyDataStore';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';
import { UnavailableSchedulePolicyAuthoring } from '../../src/api/schedulePolicyAuthoring';
import type { SchedulePolicyTransport } from '../../src/api/schedulePolicyAuthoring';

/** Never actually invoked in this file -- every scenario below rejects at the crypto/trust gate, before schedule-policy submission is ever reached. */
const unreachableSchedulePolicyTransport: SchedulePolicyTransport = {
  async submit() {
    throw new Error('unreachable in this test file');
  },
};

function gateway(provider: TrustedBrowserProvider): RealParentFamilyDataGateway {
  return new RealParentFamilyDataGateway(
    provider,
    new UnavailableSchedulePolicyAuthoring('CRYPTO_REVIEW_REQUIRED'),
    unreachableSchedulePolicyTransport,
    'http://localhost',
    createLocalFamilyDataStore(),
  );
}

function snapshotWith(state: TrustedBrowserSnapshot['state']): TrustedBrowserSnapshot {
  return {
    state,
    serviceAuthenticated: state !== 'BROWSER_NOT_TRUSTED',
    browserEndpointId: 'endpoint-a',
    trustSetEpoch: state === 'TRUSTED' ? 5 : null,
    acceptedMinEpoch: state === 'TRUSTED' ? 5 : null,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
    actorDeviceSessionToken: state === 'TRUSTED' ? 'actor-device-session-token' : null,
  };
}

class StubTrustedBrowserProvider implements TrustedBrowserProvider {
  constructor(private snapshot: TrustedBrowserSnapshot) {}
  async getSnapshot() {
    return this.snapshot;
  }
  async beginServiceAuthentication() {
    return this.snapshot;
  }
  async requestPairing() {
    return this.snapshot;
  }
  async simulateParentApproval() {
    return this.snapshot;
  }
  async simulateEpochGoneStale() {
    return this.snapshot;
  }
  async simulateRevoke() {
    return this.snapshot;
  }
  async reset() {
    return this.snapshot;
  }
}

/**
 * Proves the crypto-gated family-content providers fail closed at every
 * relevant trust boundary, and that the CRYPTO_REVIEW_REQUIRED state is
 * surfaced honestly (never faked data) even for a fully TRUSTED endpoint,
 * since the crypto suite itself is not yet approved (see
 * @pca/parent-sdk-browser-runtime's cryptoGate.ts).
 */
describe('RealParentFamilyDataGateway / RealDeviceStatusClient / RealRequestClient', () => {
  it('an untrusted (never-paired) browser cannot read family data: rejects with ENDPOINT_NOT_TRUSTED', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('BROWSER_NOT_TRUSTED'));
    const client = gateway(provider);
    await expect(client.getDashboard()).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
  });

  it('a revoked browser cannot read family data: rejects with ENDPOINT_NOT_TRUSTED, not a generic error', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('REVOKED'));
    const client = gateway(provider);
    const deviceStatus = new RealDeviceStatusClient(provider, createLocalFamilyDataStore());
    const requests = new RealRequestClient('http://localhost', provider, createLocalFamilyDataStore());
    await expect(client.getScreenTime('child-1')).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
    await expect(deviceStatus.listDeviceStatuses()).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
    await expect(requests.listRequests()).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
  });

  it('a PAIRING_PENDING (not yet fully trusted) browser cannot read family data', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('PAIRING_PENDING'));
    const client = gateway(provider);
    await expect(client.getDashboard()).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
  });

  it('even a fully TRUSTED endpoint gets the honest CRYPTO_REVIEW_REQUIRED state, never fabricated data, because the crypto suite is not approved yet', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('TRUSTED'));
    const client = gateway(provider);
    await expect(client.getDashboard()).rejects.toMatchObject({ code: 'NOT_READY_CRYPTO_REVIEW' });
  });

  it('PCA-FR-092: getActivityTimeline is crypto-gated exactly like every other read -- an untrusted browser cannot read the consolidated activity timeline either', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('BROWSER_NOT_TRUSTED'));
    const client = gateway(provider);
    await expect(client.getActivityTimeline('child-1')).rejects.toMatchObject({ code: 'ENDPOINT_NOT_TRUSTED' });
  });

  it('mutations are also crypto-gated: updateScreenTime never silently "succeeds" without real decryption', async () => {
    const provider = new StubTrustedBrowserProvider(snapshotWith('BROWSER_NOT_TRUSTED'));
    const client = gateway(provider);
    await expect(client.updateScreenTime('child-1', { continuousUseLimitMinutes: 30 })).rejects.toMatchObject({
      code: 'ENDPOINT_NOT_TRUSTED',
    });
  });
});
