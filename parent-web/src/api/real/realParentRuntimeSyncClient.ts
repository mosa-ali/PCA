// Real, HTTP-backed ParentRuntimeSyncClient. Like ../real/realServiceAuthClient.ts,
// this is genuine networking code -- not a fixture -- safe to construct and
// call today, but there is no live backend relay to answer it yet in this
// repository slice (see KNOWN_BACKEND_INTEGRATION_ACTION in ../client.ts).
// It never inspects, decrypts, or fabricates the ciphertext payloads it
// carries -- per docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5,
// the relay (and this client) only ever moves opaque base64 ciphertext.
//
// EXPECTED BACKEND CONTRACT (conventional REST, all under `${apiBaseUrl}`):
//   POST /api/sync/envelopes                          body Omit<CiphertextEnvelope, 'envelopeId'|'createdAtUtc'>
//                                                        -> 201 { envelopeId }
//   GET  /api/sync/endpoints/:endpointId/queue          -> 200 QueuedEnvelopeStatus[]
//   POST /api/sync/envelopes/:envelopeId/ack             -> 200 { acknowledged: boolean }
//   GET  /api/sync/status                                -> 200 ConnectionStatus
//   GET  /api/sync/last-sync                             -> 200 { lastSuccessfulSyncAtUtc: string | null }
//   GET  /api/sync/endpoints/:endpointId/pending          -> 200 PendingDeliveryStatus
//
// Session model matches RealServiceAuthClient: `credentials: 'include'`,
// relies on the backend's HttpOnly session cookie -- no bearer token is
// ever read from or written to JS-reachable storage by this client.
import type {
  CiphertextEnvelope,
  ConnectionStatus,
  ParentRuntimeSyncClient,
  PendingDeliveryStatus,
  QueuedEnvelopeStatus,
} from '../runtimeSyncClient';

export class RuntimeSyncNetworkError extends Error {
  constructor(cause: unknown, operation: string) {
    const message = cause instanceof Error ? cause.message : 'Network request failed';
    super(`Could not reach the PCA sync relay for ${operation}: ${message}`);
    this.name = 'RuntimeSyncNetworkError';
  }
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Real HTTP implementation of ParentRuntimeSyncClient. Not fixture-backed. */
export class RealParentRuntimeSyncClient implements ParentRuntimeSyncClient {
  constructor(private readonly apiBaseUrl: string) {}

  private url(path: string): string {
    return `${this.apiBaseUrl.replace(/\/+$/, '')}${path}`;
  }

  private async request(operation: string, path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(this.url(path), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...init,
      });
    } catch (err) {
      throw new RuntimeSyncNetworkError(err, operation);
    }
  }

  async submitCiphertextEnvelope(
    envelope: Omit<CiphertextEnvelope, 'envelopeId' | 'createdAtUtc'>,
  ): Promise<{ envelopeId: string }> {
    const response = await this.request('submitCiphertextEnvelope', '/api/sync/envelopes', {
      method: 'POST',
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      throw new Error(`submitCiphertextEnvelope: unexpected status ${response.status}`);
    }
    const body = await parseJsonSafe<{ envelopeId: string }>(response);
    if (!body) throw new Error('submitCiphertextEnvelope: empty response body');
    return body;
  }

  async listQueuedForEndpoint(endpointId: string): Promise<QueuedEnvelopeStatus[]> {
    const response = await this.request(
      'listQueuedForEndpoint',
      `/api/sync/endpoints/${encodeURIComponent(endpointId)}/queue`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(`listQueuedForEndpoint: unexpected status ${response.status}`);
    }
    return (await parseJsonSafe<QueuedEnvelopeStatus[]>(response)) ?? [];
  }

  async acknowledgeEnvelope(envelopeId: string): Promise<{ acknowledged: boolean }> {
    const response = await this.request(
      'acknowledgeEnvelope',
      `/api/sync/envelopes/${encodeURIComponent(envelopeId)}/ack`,
      { method: 'POST' },
    );
    if (!response.ok) return { acknowledged: false };
    const body = await parseJsonSafe<{ acknowledged: boolean }>(response);
    return body ?? { acknowledged: false };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    try {
      const response = await this.request('getConnectionStatus', '/api/sync/status', { method: 'GET' });
      if (!response.ok) {
        return { state: 'UNKNOWN', checkedAtUtc: new Date().toISOString() };
      }
      const body = await parseJsonSafe<ConnectionStatus>(response);
      return body ?? { state: 'UNKNOWN', checkedAtUtc: new Date().toISOString() };
    } catch {
      // Connection-status checks must never throw -- an unreachable relay
      // IS the honest OFFLINE/UNKNOWN signal, not an error state.
      return { state: 'OFFLINE', checkedAtUtc: new Date().toISOString() };
    }
  }

  async getLastSuccessfulSync(): Promise<string | null> {
    try {
      const response = await this.request('getLastSuccessfulSync', '/api/sync/last-sync', { method: 'GET' });
      if (!response.ok) return null;
      const body = await parseJsonSafe<{ lastSuccessfulSyncAtUtc: string | null }>(response);
      return body?.lastSuccessfulSyncAtUtc ?? null;
    } catch {
      return null;
    }
  }

  async getPendingDeliveryStatus(endpointId: string): Promise<PendingDeliveryStatus> {
    const response = await this.request(
      'getPendingDeliveryStatus',
      `/api/sync/endpoints/${encodeURIComponent(endpointId)}/pending`,
      { method: 'GET' },
    );
    if (!response.ok) {
      throw new Error(`getPendingDeliveryStatus: unexpected status ${response.status}`);
    }
    const body = await parseJsonSafe<PendingDeliveryStatus>(response);
    if (!body) throw new Error('getPendingDeliveryStatus: empty response body');
    return body;
  }
}
