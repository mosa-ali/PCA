import { describe, expect, it } from 'vitest';
import { RealParentFamilyDataGateway } from '../../src/api/real/realParentFamilyDataGateway';
import { RealDeviceStatusClient } from '../../src/api/real/realDeviceStatusClient';
import { RealRequestClient } from '../../src/api/real/realRequestClient';
import { createLocalFamilyDataStore } from '../../src/security/localFamilyDataStore';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';
import { UnavailableSchedulePolicyAuthoring } from '../../src/api/schedulePolicyAuthoring';
import type { SchedulePolicyTransport } from '../../src/api/schedulePolicyAuthoring';

const transport: SchedulePolicyTransport = { async submit() { throw new Error('unreachable'); } };

function snapshot(): TrustedBrowserSnapshot {
  return {
    state: 'BROWSER_NOT_TRUSTED',
    serviceAuthenticated: false,
    browserEndpointId: null,
    trustSetEpoch: null,
    acceptedMinEpoch: null,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
    actorDeviceSessionToken: null,
  };
}

class BrowserProvider implements TrustedBrowserProvider {
  calls = 0;
  async getSnapshot() { this.calls += 1; return snapshot(); }
  async beginServiceAuthentication() { return snapshot(); }
  async requestPairing() { return snapshot(); }
  async simulateParentApproval() { return snapshot(); }
  async simulateEpochGoneStale() { return snapshot(); }
  async simulateRevoke() { return snapshot(); }
  async reset() { return snapshot(); }
}

function gateway(): RealParentFamilyDataGateway {
  return new RealParentFamilyDataGateway(
    new UnavailableSchedulePolicyAuthoring('CRYPTO_REVIEW_REQUIRED'),
    transport,
    'http://localhost',
    createLocalFamilyDataStore(),
  );
}

describe('Parent family reads keep the crypto review gate and do not use browser trust as Parent authority', () => {
  it('family data, device status and request reads remain unavailable while crypto review is pending', async () => {
    const provider = new BrowserProvider();
    const store = createLocalFamilyDataStore();
    const requests = new RealRequestClient('http://localhost', provider, store);
    const deviceStatus = new RealDeviceStatusClient(store);
    await expect(gateway().getDashboard()).rejects.toMatchObject({ code: 'NOT_READY_CRYPTO_REVIEW' });
    await expect(deviceStatus.listDeviceStatuses()).rejects.toMatchObject({ code: 'NOT_READY_CRYPTO_REVIEW' });
    await expect(requests.listRequests()).rejects.toMatchObject({ code: 'NOT_READY_CRYPTO_REVIEW' });
    expect(provider.calls).toBe(0);
  });

  it('policy writes remain blocked by crypto review, without requiring browser trust to reach that boundary', async () => {
    const provider = new BrowserProvider();
    await expect(gateway().updateScreenTime('child-1', { continuousUseLimitMinutes: 30 })).rejects.toMatchObject({
      code: 'NOT_READY_CRYPTO_REVIEW',
    });
    expect(provider.calls).toBe(0);
  });
});
