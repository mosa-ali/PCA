import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevRuntimeSyncClient } from '../../src/api/dev/devRuntimeSyncClient';

describe('DevRuntimeSyncClient', () => {
  let client: DevRuntimeSyncClient;

  beforeEach(() => {
    client = new DevRuntimeSyncClient();
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('reports ONLINE connection status by default', async () => {
    const status = await client.getConnectionStatus();
    expect(status.state).toBe('ONLINE');
  });

  it('reports OFFLINE when navigator.onLine is false', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const status = await client.getConnectionStatus();
    expect(status.state).toBe('OFFLINE');
  });

  it('submitted envelopes appear as queued for their target endpoint until acknowledged', async () => {
    const { envelopeId } = await client.submitCiphertextEnvelope({
      targetEndpointId: 'device-child-amir',
      policyRevision: 3,
      payloadCiphertextBase64: 'ZGV2LWNpcGhlcnRleHQ=',
    });
    const queued = await client.listQueuedForEndpoint('device-child-amir');
    expect(queued.some((e) => e.envelopeId === envelopeId)).toBe(true);

    const pendingBefore = await client.getPendingDeliveryStatus('device-child-amir');
    expect(pendingBefore.pendingCount).toBeGreaterThan(0);

    const ack = await client.acknowledgeEnvelope(envelopeId);
    expect(ack.acknowledged).toBe(true);

    const stillQueued = await client.listQueuedForEndpoint('device-child-amir');
    const entry = stillQueued.find((e) => e.envelopeId === envelopeId);
    expect(entry?.deliveryState).toBe('DELIVERED');
  });

  it('acknowledging an unknown envelope id reports not-acknowledged rather than throwing', async () => {
    const ack = await client.acknowledgeEnvelope('does-not-exist');
    expect(ack.acknowledged).toBe(false);
  });

  it('getLastSuccessfulSync returns an ISO timestamp', async () => {
    const last = await client.getLastSuccessfulSync();
    expect(last === null || !Number.isNaN(Date.parse(last))).toBe(true);
  });
});
