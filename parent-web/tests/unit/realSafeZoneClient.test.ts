import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealSafeZoneClient } from '../../src/api/real/realSafeZoneClient';

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

    const result = await new RealSafeZoneClient('https://pca.example').list('family-1');
    expect(result).toEqual([safeZone]);
  });

  it('rejects a response that attempts to add plaintext zone fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ safeZones: [{ ...safeZone, label: 'Home', latitude: 24.7 }] }),
    })));

    await expect(new RealSafeZoneClient('https://pca.example').list('family-1'))
      .rejects.toThrow('SAFE_ZONE_RESPONSE_INVALID');
  });

  it('reads family safe zones through the Parent session without a browser trust provider', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ safeZones: [safeZone] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new RealSafeZoneClient('https://pca.example').list('family-1')).resolves.toEqual([safeZone]);
  });

  it('rejects a plaintext-shaped create before it can reach fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RealSafeZoneClient('https://pca.example').create('family-1', {
      label: 'Home',
      latitude: 24.7,
      longitude: 46.6,
      radiusMeters: 200,
      enabled: true,
    } as never)).rejects.toThrow('SAFE_ZONE_REQUEST_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects extra fields and malformed identifiers before update/delete fetches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealSafeZoneClient('https://pca.example');

    await expect(client.update('family-1', 'zone-1', { ciphertextB64: 'AQID', label: 'Home' } as never))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    await expect(client.remove('family with spaces', 'zone-1')).rejects.toThrow('SAFE_ZONE_REQUEST_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Parent session cookie and does not send a browser device token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ safeZones: [safeZone] }) }));
    vi.stubGlobal('fetch', fetchMock);

    await new RealSafeZoneClient('https://pca.example').list('family-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['x-pca-actor-device-id']).toBeUndefined();
  });
});
