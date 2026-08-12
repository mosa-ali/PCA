import type {
  CiphertextEnvelope,
  ConnectionStatus,
  ParentRuntimeSyncClient,
  PendingDeliveryStatus,
  QueuedEnvelopeStatus,
} from '../runtimeSyncClient';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

let envelopeSeq = 0;
const queue = new Map<string, QueuedEnvelopeStatus>();
let lastSuccessfulSyncUtc: string | null = new Date(Date.now() - 5 * 60 * 1000).toISOString();

function currentConnectionState(): ConnectionStatus['state'] {
  // Dev stub: reflects the browser's own connectivity signal. A real
  // implementation would also consider relay reachability, not just
  // navigator.onLine.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'OFFLINE';
  return 'ONLINE';
}

/**
 * DEVELOPMENT_ONLY fixture implementation of ParentRuntimeSyncClient.
 * Simulates a small in-memory delivery queue; no real transport, no real
 * ciphertext validation.
 */
export class DevRuntimeSyncClient implements ParentRuntimeSyncClient {
  async submitCiphertextEnvelope(
    envelope: Omit<CiphertextEnvelope, 'envelopeId' | 'createdAtUtc'>,
  ): Promise<{ envelopeId: string }> {
    await delay();
    envelopeSeq += 1;
    const envelopeId = `dev-envelope-${envelopeSeq}`;
    queue.set(envelopeId, {
      envelopeId,
      targetEndpointId: envelope.targetEndpointId,
      policyRevision: envelope.policyRevision,
      queuedAtUtc: new Date().toISOString(),
      deliveryState: currentConnectionState() === 'OFFLINE' ? 'QUEUED' : 'PENDING_DELIVERY',
    });
    if (currentConnectionState() === 'ONLINE') lastSuccessfulSyncUtc = new Date().toISOString();
    return { envelopeId };
  }

  async listQueuedForEndpoint(endpointId: string): Promise<QueuedEnvelopeStatus[]> {
    await delay(60);
    return [...queue.values()].filter((e) => e.targetEndpointId === endpointId);
  }

  async acknowledgeEnvelope(envelopeId: string): Promise<{ acknowledged: boolean }> {
    await delay(60);
    const entry = queue.get(envelopeId);
    if (!entry) return { acknowledged: false };
    queue.set(envelopeId, { ...entry, deliveryState: 'DELIVERED' });
    lastSuccessfulSyncUtc = new Date().toISOString();
    return { acknowledged: true };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    await delay(30);
    return { state: currentConnectionState(), checkedAtUtc: new Date().toISOString() };
  }

  async getLastSuccessfulSync(): Promise<string | null> {
    await delay(20);
    return lastSuccessfulSyncUtc;
  }

  async getPendingDeliveryStatus(endpointId: string): Promise<PendingDeliveryStatus> {
    await delay(60);
    const pending = [...queue.values()].filter(
      (e) => e.targetEndpointId === endpointId && e.deliveryState !== 'DELIVERED',
    );
    return {
      targetEndpointId: endpointId,
      pendingCount: pending.length,
      oldestQueuedAtUtc: pending.length > 0 ? pending[0].queuedAtUtc : null,
    };
  }
}
