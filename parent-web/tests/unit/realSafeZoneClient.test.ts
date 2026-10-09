import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealSafeZoneClient } from '../../src/api/real/realSafeZoneClient';
import type { TrustedBrowserProvider } from '../../src/domain/trustedBrowser';

function browser(state: 'TRUSTED' | 'PAIRING_PENDING' = 'TRUSTED', token: string | null = 'device-session-token') {
  return {
    getSnapshot: async () => ({ state, actorDeviceSessionToken: token }),
  } as unknown as TrustedBrowserProvider;
}

const safeZone = {
  zoneId: 'zone-1',
  familyId: 'family-1',
  recipientEndpointId: 'device-1',
  ciphertextB64: 'AQID',
  nonceB64: 'AQIDBAUGBwgJCgsM',
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

    const result = await new RealSafeZoneClient('https://pca.example', browser()).list('family-1');
    expect(result).toEqual([safeZone]);
  });

  it('rejects a response that attempts to add plaintext zone fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ safeZones: [{ ...safeZone, label: 'Home', latitude: 24.7 }] }),
    })));

    await expect(new RealSafeZoneClient('https://pca.example', browser()).list('family-1'))
      .rejects.toThrow('SAFE_ZONE_RESPONSE_INVALID');
  });

  it('rejects malformed, padded, and noncanonical base64url envelope bytes', async () => {
    for (const invalidEnvelope of [
      { ...safeZone, ciphertextB64: '' },
      { ...safeZone, ciphertextB64: 'AQID+' },
      { ...safeZone, ciphertextB64: 'AQID=' },
      { ...safeZone, ciphertextB64: 'AB' },
      { ...safeZone, nonceB64: 'AA' },
      { ...safeZone, nonceB64: 'AQIDBAUGBwgJCgs=' },
      { ...safeZone, nonceB64: `${'A'.repeat(17)}B` },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ safeZones: [invalidEnvelope] }),
      })));

      await expect(new RealSafeZoneClient('https://pca.example', browser()).list('family-1'))
        .rejects.toThrow('SAFE_ZONE_RESPONSE_INVALID');
    }
  });

  it('accepts ciphertext and nonce exactly at the repository byte ceilings', async () => {
    const atCeiling = {
      ...safeZone,
      ciphertextB64: 'A'.repeat(87_380), // 65,535 decoded bytes
      nonceB64: 'A'.repeat(86), // 64 decoded bytes
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ safeZones: [atCeiling] }) })));

    await expect(new RealSafeZoneClient('https://pca.example', browser()).list('family-1'))
      .resolves.toEqual([atCeiling]);
  });

  it('rejects ciphertext and nonce that exceed repository byte ceilings', async () => {
    for (const invalidEnvelope of [
      { ...safeZone, ciphertextB64: 'A'.repeat(87_382) }, // 65,536 decoded bytes
      { ...safeZone, nonceB64: 'A'.repeat(87) }, // 65 decoded bytes
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ safeZones: [invalidEnvelope] }),
      })));

      await expect(new RealSafeZoneClient('https://pca.example', browser()).list('family-1'))
        .rejects.toThrow('SAFE_ZONE_RESPONSE_INVALID');
    }
  });

  it('reads family safe zones through the Parent session without a browser trust provider', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ safeZones: [safeZone] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new RealSafeZoneClient('https://pca.example', browser()).list('family-1')).resolves.toEqual([safeZone]);
  });

  it('rejects a plaintext-shaped create before it can reach fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RealSafeZoneClient('https://pca.example', browser()).create('family-1', {
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
    const client = new RealSafeZoneClient('https://pca.example', browser());

    await expect(client.update('family-1', 'zone-1', { ciphertextB64: 'AQID', label: 'Home' } as never))
      .rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    await expect(client.remove('family with spaces', 'zone-1')).rejects.toThrow('SAFE_ZONE_REQUEST_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Parent session and verified browser device token for policy mutations', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ safeZone }) }));
    vi.stubGlobal('fetch', fetchMock);

    await new RealSafeZoneClient('https://pca.example', browser()).create('family-1', {
      recipientEndpointId: 'device-1',
      ciphertextB64: 'AQID',
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer device-session-token');
    expect(headers['x-pca-actor-device-id']).toBeUndefined();
  });

  it('rejects policy mutations unless the browser is trusted and has a verified device session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealSafeZoneClient('https://pca.example', browser('PAIRING_PENDING', null));

    await expect(client.remove('family-1', 'zone-1')).rejects.toThrow('TRUSTED_BROWSER_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
