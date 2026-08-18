import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealSafeZoneClient } from '../../src/api/real/realSafeZoneClient';
import type { TrustedBrowserProvider } from '../../src/domain/trustedBrowser';

const trustedBrowser = {
  getSnapshot: vi.fn(async () => ({
    state: 'TRUSTED' as const,
    serviceAuthenticated: true,
    browserEndpointId: 'browser-1',
    trustSetEpoch: 4,
    acceptedMinEpoch: 4,
    pairingRequestedAtUtc: null,
    lastFingerprint: null,
  })),
} as unknown as TrustedBrowserProvider;

const safeZone = {
  zoneId: 'zone-1',
  familyId: 'family-1',
  recipientEndpointId: 'device-1',
  ciphertextB64: 'ciphertext-_1',
  nonceB64: 'nonce-_1',
  keyEpoch: 7,
  revision: 2,
  deliveryState: 'READY' as const,
  createdAtUtc: '2026-01-01T00:00:00.000Z',
  updatedAtUtc: '2026-01-02T00:00:00.000Z',
};

describe('RealSafeZoneClient opaque response boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts only the opaque service contract and never exposes readable policy fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ safeZones: [safeZone] }),
    })));

    const result = await new RealSafeZoneClient('https://pca.example', trustedBrowser).list('family-1');
    expect(result).toEqual([safeZone]);
  });

  it('rejects a response that attempts to add plaintext zone fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ safeZones: [{ ...safeZone, label: 'Home', latitude: 24.7 }] }),
    })));

    await expect(new RealSafeZoneClient('https://pca.example', trustedBrowser).list('family-1'))
      .rejects.toThrow('SAFE_ZONE_RESPONSE_INVALID');
  });

  it('does not call the safe-zone endpoint from an untrusted browser', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const untrusted = {
      ...trustedBrowser,
      getSnapshot: vi.fn(async () => ({ ...(await trustedBrowser.getSnapshot()), state: 'PAIRING_REQUIRED' as const })),
    } as unknown as TrustedBrowserProvider;

    await expect(new RealSafeZoneClient('https://pca.example', untrusted).list('family-1'))
      .rejects.toThrow('TRUSTED_BROWSER_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
