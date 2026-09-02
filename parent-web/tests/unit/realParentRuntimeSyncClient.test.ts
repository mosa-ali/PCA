import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealParentRuntimeSyncClient, ParentRuntimeSyncApiError } from '../../src/api/real/realParentRuntimeSyncClient';
import { UnavailableParentRuntimeSyncClient } from '../../src/api/real/unavailableProviders';
import { ServiceUnavailableError } from '../../src/api/unavailable';

function stubFamilySessionAndFetch(fetchImpl: (input: unknown, init?: RequestInit) => Promise<unknown>, familyId: string | null = 'family-1') {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/parent/session')) {
      return familyId ? { ok: true, json: async () => ({ familyId }) } : { ok: false, status: 401 };
    }
    return fetchImpl(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RealParentRuntimeSyncClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extends UnavailableParentRuntimeSyncClient -- inherits fail-closed mutating envelope methods unchanged', async () => {
    const client = new RealParentRuntimeSyncClient('https://pca.example');
    expect(client).toBeInstanceOf(UnavailableParentRuntimeSyncClient);

    await expect(
      client.submitCiphertextEnvelope({ targetEndpointId: 'device-1', policyRevision: 1, payloadCiphertextBase64: 'AA==' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(client.listQueuedForEndpoint('device-1')).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(client.acknowledgeEnvelope('envelope-1')).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('getPendingDeliveryStatus() calls the real device-scoped status route with the resolved familyId and cookie credentials', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({
        deviceId: 'device-amir',
        connectionState: 'LIVE',
        lastSuccessfulSyncAtUtc: '2026-08-01T00:00:00.000Z',
        pendingDelivery: { pendingCount: 3, oldestQueuedAtUtc: '2026-08-01T00:01:00.000Z' },
      }),
    }));

    const result = await new RealParentRuntimeSyncClient('https://pca.example').getPendingDeliveryStatus('device-amir');

    expect(result).toEqual({ targetEndpointId: 'device-amir', pendingCount: 3, oldestQueuedAtUtc: '2026-08-01T00:01:00.000Z' });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/runtime-sync/devices/'));
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://pca.example/v1/families/family-1/runtime-sync/devices/device-amir/status');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('getLastSuccessfulSync(deviceId) returns the real per-device timestamp from the status route', async () => {
    stubFamilySessionAndFetch(async () => ({
      ok: true,
      json: async () => ({
        deviceId: 'device-amir',
        connectionState: 'STALE',
        lastSuccessfulSyncAtUtc: '2026-07-15T08:30:00.000Z',
        pendingDelivery: { pendingCount: 0, oldestQueuedAtUtc: null },
      }),
    }));

    const result = await new RealParentRuntimeSyncClient('https://pca.example').getLastSuccessfulSync('device-amir');
    expect(result).toBe('2026-07-15T08:30:00.000Z');
  });

  it('getLastSuccessfulSync() with NO deviceId honestly returns null without issuing any device-status request (family-wide, no single device to scope to)', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => {
      throw new Error('should not reach the device-status endpoint');
    });

    const result = await new RealParentRuntimeSyncClient('https://pca.example').getLastSuccessfulSync();
    expect(result).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/runtime-sync/devices/'))).toBe(false);
  });

  it('getConnectionStatus() reports ONLINE when the family session resolves, without calling the device-status route', async () => {
    const fetchMock = stubFamilySessionAndFetch(async () => {
      throw new Error('should not reach the device-status endpoint');
    }, 'family-1');

    const status = await new RealParentRuntimeSyncClient('https://pca.example').getConnectionStatus();
    expect(status.state).toBe('ONLINE');
    expect(typeof status.checkedAtUtc).toBe('string');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/runtime-sync/devices/'))).toBe(false);
  });

  it('getConnectionStatus() reports OFFLINE (never throws) when no family session is available', async () => {
    stubFamilySessionAndFetch(async () => {
      throw new Error('should not reach the device-status endpoint');
    }, null);

    const status = await new RealParentRuntimeSyncClient('https://pca.example').getConnectionStatus();
    expect(status.state).toBe('OFFLINE');
  });

  it('getPendingDeliveryStatus() throws a typed FAMILY_CONTEXT_UNAVAILABLE error when no family session is available, rather than fabricating an empty-queue result', async () => {
    stubFamilySessionAndFetch(async () => {
      throw new Error('should not reach the device-status endpoint');
    }, null);

    await expect(new RealParentRuntimeSyncClient('https://pca.example').getPendingDeliveryStatus('device-amir')).rejects.toMatchObject({
      code: 'FAMILY_CONTEXT_UNAVAILABLE',
    });
  });

  it('surfaces a 403 from the backend (cross-family / authz denial) as a typed FORBIDDEN error, never a silent empty result', async () => {
    stubFamilySessionAndFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }));

    const error = await new RealParentRuntimeSyncClient('https://pca.example')
      .getPendingDeliveryStatus('device-amir')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ParentRuntimeSyncApiError);
    expect((error as ParentRuntimeSyncApiError).code).toBe('FORBIDDEN');
    expect((error as ParentRuntimeSyncApiError).httpStatus).toBe(403);
  });

  it('surfaces a 404 (unknown/cross-family device) as a typed NOT_FOUND error', async () => {
    stubFamilySessionAndFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) }));

    await expect(new RealParentRuntimeSyncClient('https://pca.example').getLastSuccessfulSync('device-amir')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('surfaces a network failure as a typed NETWORK_ERROR, never a silent null/zero result', async () => {
    stubFamilySessionAndFetch(async () => {
      throw new Error('DNS resolution failed');
    });

    await expect(new RealParentRuntimeSyncClient('https://pca.example').getPendingDeliveryStatus('device-amir')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});
