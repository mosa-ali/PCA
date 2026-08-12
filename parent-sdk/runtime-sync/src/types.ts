export type SyncConnectionState = 'OFFLINE' | 'SYNC_PENDING' | 'SYNCING' | 'LIVE' | 'STALE';

export interface OutboundEnvelopeInput {
  messageId: string;
  recipientDeviceId: string;
  /** Opaque wire bytes for the FamilyEnvelope this ciphertext carries -- never inspected by this SDK. */
  ciphertext: Uint8Array;
  messageType: string;
  enqueuedAtEpochMillis: number;
  ttlMs?: number;
}

export type OutboundItemOutcome =
  | { messageId: string; outcome: 'QUEUED' }
  | { messageId: string; outcome: 'CROSS_FAMILY_RECIPIENT' }
  | { messageId: string; outcome: 'CONFLICT' }
  | { messageId: string; outcome: 'INVALID' };

export interface OutboundBatchResult {
  results: OutboundItemOutcome[];
  droppedForBatchBound: string[];
}

export interface InboundEnvelope {
  messageId: string;
  senderDeviceId: string;
  messageType: string;
  /** Still ciphertext -- decrypting/dispatching it is the caller's job, never this SDK's (see doc 40 Section 6). */
  payload: Uint8Array;
}

export interface SyncReceiptView {
  messageId: string;
  outcome: 'RECEIVED' | 'HELD_PENDING' | 'APPLIED' | 'REJECTED' | 'EXPIRED';
  atUtc: string;
  reason: string | null;
}

export interface ReconnectDrainResult {
  applied: InboundEnvelope[];
  receipts: SyncReceiptView[];
  unparseableMessageIds: string[];
  droppedForListBound: string[];
}

export interface DeviceSession {
  sessionToken: string;
  expiresAt: string;
}
