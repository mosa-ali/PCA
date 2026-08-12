import { bytesToBase64, base64ToBytes } from './base64.js';
import type { DeviceSession, InboundEnvelope, OutboundBatchResult, OutboundEnvelopeInput, ReconnectDrainResult, SyncConnectionState, SyncReceiptView } from './types.js';

export type RuntimeSyncTransportErrorCode = 'UNAUTHORIZED' | 'INVALID_REQUEST' | 'NETWORK' | 'UNKNOWN';

export class RuntimeSyncTransportError extends Error {
  readonly code: RuntimeSyncTransportErrorCode;
  constructor(code: RuntimeSyncTransportErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeSyncTransportError';
    this.code = code;
  }
}

/**
 * Port matching backend/src/http/routes/runtimeSyncRoutes.ts's surface
 * exactly (doc 40 Section 4) -- one method per route. Never a generic
 * "makeRequest" escape hatch, so every call site stays typed to the real
 * wire contract.
 */
export interface RuntimeSyncTransport {
  issueChallenge(deviceId: string): Promise<{ challengeId: string; nonce: string; expiresAt: string }>;
  completeChallenge(deviceId: string, challengeId: string, signature: string): Promise<DeviceSession>;
  submitOutbound(sessionToken: string, items: readonly OutboundEnvelopeInput[]): Promise<OutboundBatchResult>;
  listInbound(sessionToken: string): Promise<ReconnectDrainResult>;
  acknowledgeInbound(sessionToken: string, messageId: string): Promise<void>;
  getStatus(sessionToken: string): Promise<{ connectionState: SyncConnectionState }>;
}

interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface FetchRuntimeSyncTransportOptions {
  baseUrl: string;
  /** Injected so this stays testable without a real network stack, and so a caller in an environment without a global `fetch` can supply a polyfill. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

function authHeader(sessionToken: string): Record<string, string> {
  return { authorization: `Bearer ${sessionToken}` };
}

async function parseJsonResponse(response: { ok: boolean; status: number; json(): Promise<unknown> }): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return body;
  if (response.status === 401) throw new RuntimeSyncTransportError('UNAUTHORIZED', 'Authentication failed.');
  if (response.status >= 400 && response.status < 500) throw new RuntimeSyncTransportError('INVALID_REQUEST', 'Request was rejected.');
  throw new RuntimeSyncTransportError('UNKNOWN', 'Unexpected server response.');
}

/**
 * Real HTTP implementation of RuntimeSyncTransport using the platform
 * `fetch` (available globally in Node >=18 and every modern browser --
 * this package adds no HTTP client dependency).
 */
export class FetchRuntimeSyncTransport implements RuntimeSyncTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: FetchRuntimeSyncTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (!this.fetchImpl) {
      throw new Error('No fetch implementation available -- supply fetchImpl explicitly.');
    }
  }

  private async request(path: string, method: string, sessionToken: string | null, body?: unknown): Promise<unknown> {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(sessionToken ? authHeader(sessionToken) : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new RuntimeSyncTransportError('NETWORK', 'The request could not be sent.');
    }
    return parseJsonResponse(response);
  }

  async issueChallenge(deviceId: string): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    const result = (await this.request(`/v1/runtime-sync/devices/${encodeURIComponent(deviceId)}/challenge`, 'POST', null)) as {
      challengeId: string;
      nonce: string;
      expiresAt: string;
    };
    return result;
  }

  async completeChallenge(deviceId: string, challengeId: string, signature: string): Promise<DeviceSession> {
    const result = (await this.request(`/v1/runtime-sync/devices/${encodeURIComponent(deviceId)}/session`, 'POST', null, {
      challengeId,
      signature,
    })) as { sessionToken: string; expiresAt: string };
    return result;
  }

  async submitOutbound(sessionToken: string, items: readonly OutboundEnvelopeInput[]): Promise<OutboundBatchResult> {
    const result = (await this.request('/v1/runtime-sync/outbound', 'POST', sessionToken, {
      items: items.map((item) => ({
        messageId: item.messageId,
        recipientDeviceId: item.recipientDeviceId,
        ciphertext: bytesToBase64(item.ciphertext),
        messageType: item.messageType,
        enqueuedAtEpochMillis: item.enqueuedAtEpochMillis,
        ...(item.ttlMs !== undefined ? { ttlMs: item.ttlMs } : {}),
      })),
    })) as OutboundBatchResult;
    return result;
  }

  async listInbound(sessionToken: string): Promise<ReconnectDrainResult> {
    const raw = (await this.request('/v1/runtime-sync/inbound', 'GET', sessionToken)) as {
      applied: Array<{ messageId: string; senderDeviceId: string; messageType: string; payload: string }>;
      receipts: SyncReceiptView[];
      unparseableMessageIds: string[];
      droppedForListBound: string[];
    };
    const applied: InboundEnvelope[] = raw.applied.map((entry) => ({
      messageId: entry.messageId,
      senderDeviceId: entry.senderDeviceId,
      messageType: entry.messageType,
      payload: base64ToBytes(entry.payload),
    }));
    return { applied, receipts: raw.receipts, unparseableMessageIds: raw.unparseableMessageIds, droppedForListBound: raw.droppedForListBound };
  }

  async acknowledgeInbound(sessionToken: string, messageId: string): Promise<void> {
    await this.request(`/v1/runtime-sync/inbound/${encodeURIComponent(messageId)}/ack`, 'POST', sessionToken);
  }

  async getStatus(sessionToken: string): Promise<{ connectionState: SyncConnectionState }> {
    const result = (await this.request('/v1/runtime-sync/status', 'GET', sessionToken)) as { connectionState: SyncConnectionState };
    return result;
  }
}
