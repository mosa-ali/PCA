// ParentRuntimeSyncClient -- the browser-side port for the backend relay
// that carries opaque, already-encrypted policy envelopes between the
// parent web console and child devices. Per
// docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5, the relay never
// sees plaintext family content -- it only stores/forwards ciphertext this
// module treats as opaque, and reports delivery/connection bookkeeping.
//
// This interface is intentionally backend-agnostic (no assumption about
// HTTP vs. WebSocket vs. long-poll transport).
//
// STATUS (mixed, see ../real/realParentRuntimeSyncClient.ts and
// ../real/unavailableProviders.ts's own headers for the full story):
//   - The 3 read-only bookkeeping methods (getConnectionStatus/
//     getLastSuccessfulSync/getPendingDeliveryStatus) are now genuinely
//     HTTP-backed against backend/src/http/routes/parentRuntimeSyncRoutes.ts.
//   - submitCiphertextEnvelope/listQueuedForEndpoint/acknowledgeEnvelope
//     remain a documented KNOWN_BACKEND_INTEGRATION_ACTION (see ./client.ts):
//     they require the parent-sdk's E2EE envelope crypto, gated on a human
//     security review, and stay genuinely unimplemented in this repository
//     slice -- this repo slice ships only the typed port and a
//     DEVELOPMENT_ONLY fixture for those three.

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
  /**
   * Family-wide relay reachability -- NOT scoped to any one device. See
   * ../real/realParentRuntimeSyncClient.ts's own doc comment for exactly
   * what a real implementation can honestly answer here: the parent browser
   * itself holds no persistent relay/device session today (that requires
   * the same not-yet-built device-session ceremony the mutating envelope
   * methods above are also gated behind), so this is answerable only as
   * "can this browser reach the parent-session API at all," never a
   * per-device signal.
   */
  getConnectionStatus(): Promise<ConnectionStatus>;
  /**
   * ISO timestamp of the last time a sync succeeded, or null if never (or
   * unknown). Optionally scoped to a single family device via `deviceId`
   * (Dashboard/ChildOverview/ScreenTimePage all have one in scope and pass
   * it) -- with a deviceId, this is that device's real last-successful-sync
   * timestamp; without one (e.g. useReconnectSync's family-wide, no-single-
   * device reconnect pass), a real implementation honestly returns null
   * rather than fabricating a family-wide aggregate this backend does not
   * compute.
   */
  getLastSuccessfulSync(deviceId?: string): Promise<string | null>;
  getPendingDeliveryStatus(endpointId: string): Promise<PendingDeliveryStatus>;
}
