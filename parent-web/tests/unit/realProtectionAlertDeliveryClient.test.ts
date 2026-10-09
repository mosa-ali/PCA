// PCA product-completion programme (/security/status): proves
// RealProtectionAlertDeliveryClient genuinely fetches opaque protection-alert
// envelopes from the family's real queue -- honestly reporting
// PENDING_TRUSTED_DECRYPTION whenever Parent session resolution, network,
// no resolvable family, network failure,
// a malformed response) is unavailable, and READY with real alerts only
// once every link succeeds. A genuinely empty envelope list is reported as
// READY/empty, never conflated with a pending state. Mirrors
// realFamilyAuditDeliveryClient.test.ts's own structure for the
// structurally identical audit-trail feed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealProtectionAlertDeliveryClient } from '../../src/api/real/realProtectionAlertDeliveryClient';
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

const NOT_TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  ...TRUSTED_SNAPSHOT,
  state: 'BROWSER_NOT_TRUSTED',
  actorDeviceSessionToken: null,
};

const TRUSTED_WITHOUT_DEVICE_SESSION: TrustedBrowserSnapshot = {
  ...TRUSTED_SNAPSHOT,
  actorDeviceSessionToken: null,
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealProtectionAlertDeliveryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch the device queue until the browser has a trusted actor-device session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { familyId: 'fam-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(NOT_TRUSTED_SNAPSHOT));
    const result = await client.list();
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/parent/session');
  });

  it('fails closed when the trusted browser has no actor-device session token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { familyId: 'fam-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_WITHOUT_DEVICE_SESSION));
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/parent/session');
  });

  it('fetches real opaque alert envelopes and maps only their safe routing metadata (never the encrypted payload) when trusted, resolving READY', async () => {
    const envelope = {
      alertId: 'alert-1',
      deviceId: 'device-1',
      trigger: 'PROTECTION_DEGRADED',
      keyEpoch: 5,
      generatedAtUtc: '2026-01-01T00:00:00.000Z',
      encryptedPayloadB64: 'ZW5jcnlwdGVk',
      nonceB64: 'bm9uY2U=',
    };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/protection-alerts')) return Promise.resolve(jsonResponse(200, { alerts: [envelope] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    const result = await client.list();
    expect(result).toEqual({
      status: 'READY',
      alerts: [{ alertId: 'alert-1', deviceId: 'device-1', trigger: 'PROTECTION_DEGRADED', generatedAtUtc: '2026-01-01T00:00:00.000Z' }],
    });

    const alertsCall = fetchMock.mock.calls.find(([input]) => (typeof input === 'string' ? input : input.toString()).includes('/protection-alerts'));
    expect(alertsCall).toBeTruthy();
    const [, init] = alertsCall as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer actor-device-session-token');
  });

  it('reports READY with an empty list when the family genuinely has zero alerts -- never conflated with pending', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/protection-alerts')) return Promise.resolve(jsonResponse(200, { alerts: [] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    const result = await client.list();
    expect(result).toEqual({ status: 'READY', alerts: [] });
  });

  it('reports PENDING_TRUSTED_DECRYPTION on a non-ok HTTP response, never throwing', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
  });

  it('reports PENDING_TRUSTED_DECRYPTION when the response shape is malformed (e.g. an unknown trigger value), never a fabricated or partial list', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/protection-alerts')) {
        return Promise.resolve(
          jsonResponse(200, {
            alerts: [
              {
                alertId: 'alert-1',
                deviceId: null,
                trigger: 'NOT_A_REAL_TRIGGER',
                keyEpoch: 1,
                generatedAtUtc: '2026-01-01T00:00:00.000Z',
                encryptedPayloadB64: 'x',
                nonceB64: 'y',
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
  });

  it('rejects malformed and noncanonical ciphertext or nonce encodings before mapping alerts', async () => {
    const valid = {
      alertId: 'alert-1',
      deviceId: 'device-1',
      trigger: 'PROTECTION_DEGRADED',
      keyEpoch: 5,
      generatedAtUtc: '2026-01-01T00:00:00.000Z',
      encryptedPayloadB64: 'AQID',
      nonceB64: 'BAUG',
    };
    for (const invalidAlert of [
      { ...valid, encryptedPayloadB64: 'AQI-' },
      { ...valid, encryptedPayloadB64: 'AB==' },
      { ...valid, encryptedPayloadB64: 'AQID=' },
      { ...valid, nonceB64: 'AAB=' },
      { ...valid, nonceB64: 'BAUG_' },
    ]) {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
        if (url.includes('/protection-alerts')) return Promise.resolve(jsonResponse(200, { alerts: [invalidAlert] }));
        return Promise.resolve(jsonResponse(404, {}));
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
      await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    }
  });

  it('accepts canonical alert payloads at backend byte ceilings and rejects values above them', async () => {
    const baseAlert = {
      alertId: 'alert-1',
      deviceId: 'device-1',
      trigger: 'PROTECTION_DEGRADED',
      keyEpoch: 5,
      generatedAtUtc: '2026-01-01T00:00:00.000Z',
    };
    const atCeiling = {
      ...baseAlert,
      encryptedPayloadB64: `${'A'.repeat(21_844)}AA==`, // 16 KiB decoded bytes
      nonceB64: `${'A'.repeat(84)}AA==`, // 64 decoded bytes
    };
    const maxFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/protection-alerts')) return Promise.resolve(jsonResponse(200, { alerts: [atCeiling] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', maxFetch);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(client.list()).resolves.toEqual({
      status: 'READY',
      alerts: [{ alertId: 'alert-1', deviceId: 'device-1', trigger: 'PROTECTION_DEGRADED', generatedAtUtc: '2026-01-01T00:00:00.000Z' }],
    });

    for (const invalidAlert of [
      { ...atCeiling, encryptedPayloadB64: 'A'.repeat(21_852) }, // 16 KiB + 3 bytes
      { ...atCeiling, nonceB64: `${'A'.repeat(84)}AAE=` }, // 65 decoded bytes
    ]) {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
        if (url.includes('/protection-alerts')) return Promise.resolve(jsonResponse(200, { alerts: [invalidAlert] }));
        return Promise.resolve(jsonResponse(404, {}));
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    }
  });

  it('reports PENDING_TRUSTED_DECRYPTION when no family can be resolved from the session', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, {}));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealProtectionAlertDeliveryClient('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    const result = await client.list();
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(fetchMock.mock.calls.some(([input]) => (typeof input === 'string' ? input : input.toString()).includes('/protection-alerts'))).toBe(false);
  });
});
