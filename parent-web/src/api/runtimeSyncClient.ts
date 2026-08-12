// ParentRuntimeSyncClient -- the browser-side port for the (not-yet-built)
// backend relay that carries opaque, already-encrypted policy envelopes
// between the parent web console and child devices. Per
// docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5, the relay never
// sees plaintext family content -- it only stores/forwards ciphertext this
// module treats as opaque, and reports delivery/connection bookkeeping.
//
// This interface is intentionally backend-agnostic (no assumption about
// HTTP vs. WebSocket vs. long-poll transport). A real implementation is a
// documented KNOWN_BACKEND_INTEGRATION_ACTION (see ./client.ts) owned by
// the agent building the backend relay (contracts/schedule-runtime and the
// backend/ relay do not exist in this repository slice yet) -- this repo
// slice ships only the typed port and a DEVELOPMENT_ONLY fixture.

export type SyncConnectionState = 'ONLINE' | 'OFFLINE' | 'RECONNECTING' | 'UNKNOWN';

export interface ConnectionStatus {
  state: SyncConnectionState;
  /** When this status was last actually checked against the relay (or last known before going offline). */
  checkedAtUtc: string;
}

export type EnvelopeDeliveryState = 'QUEUED' | 'PENDING_DELIVERY' | 'DELIVERED' | 'FAILED';

/** Opaque encrypted policy envelope -- payload is never decrypted or inspected by this client. */
export interface CiphertextEnvelope {
  envelopeId: string;
  targetEndpointId: string;
  policyRevision: number;
  /** Opaque base64 ciphertext -- this client never reads or validates its contents. */
  payloadCiphertextBase64: string;
  createdAtUtc: string;
}

export interface QueuedEnvelopeStatus {
  envelopeId: string;
  targetEndpointId: string;
  policyRevision: number;
  queuedAtUtc: string;
  deliveryState: EnvelopeDeliveryState;
}

export interface PendingDeliveryStatus {
  targetEndpointId: string;
  pendingCount: number;
  oldestQueuedAtUtc: string | null;
}

export interface ParentRuntimeSyncClient {
  /** Submits an already-encrypted envelope for delivery to a target device/endpoint. */
  submitCiphertextEnvelope(
    envelope: Omit<CiphertextEnvelope, 'envelopeId' | 'createdAtUtc'>,
  ): Promise<{ envelopeId: string }>;
  /** Lists envelopes still queued (not yet acknowledged) for a given endpoint. */
  listQueuedForEndpoint(endpointId: string): Promise<QueuedEnvelopeStatus[]>;
  /** Acknowledges a delivery receipt (child device confirmed application) has been processed client-side. */
  acknowledgeEnvelope(envelopeId: string): Promise<{ acknowledged: boolean }>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  /** ISO timestamp of the last time this client successfully round-tripped the relay, or null if never. */
  getLastSuccessfulSync(): Promise<string | null>;
  getPendingDeliveryStatus(endpointId: string): Promise<PendingDeliveryStatus>;
}
