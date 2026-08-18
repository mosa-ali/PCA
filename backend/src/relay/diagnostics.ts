import type { RelayEnvelopeRecord } from './types.js';

export type RelayDiagnosticOutcome = 'QUEUED' | 'LISTED' | 'DELIVERED' | 'ACKNOWLEDGED' | 'EXPIRED';
export type RelayCiphertextSizeClass = 'SMALL' | 'MEDIUM' | 'LARGE';

/** PCA-FR-137: routing-only diagnostics. There is deliberately no ciphertext, decoded payload, or payload-derived field. */
export interface RelayDiagnosticEvent {
  event: 'relay_envelope';
  outcome: RelayDiagnosticOutcome;
  messageId: string;
  familyId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  state: RelayEnvelopeRecord['state'];
  ciphertextSizeClass: RelayCiphertextSizeClass;
  createdAtUtc: string;
  expiresAtUtc: string;
  acknowledgedAtUtc: string | null;
}

export function classifyCiphertextSize(byteLength: number): RelayCiphertextSizeClass {
  if (byteLength <= 1024) return 'SMALL';
  if (byteLength <= 16 * 1024) return 'MEDIUM';
  return 'LARGE';
}

export function buildRelayDiagnosticEvent(
  record: RelayEnvelopeRecord,
  outcome: RelayDiagnosticOutcome,
): RelayDiagnosticEvent {
  return {
    event: 'relay_envelope',
    outcome,
    messageId: record.messageId,
    familyId: record.familyId,
    senderDeviceId: record.senderDeviceId,
    recipientDeviceId: record.recipientDeviceId,
    state: record.state,
    ciphertextSizeClass: classifyCiphertextSize(record.ciphertext.length),
    createdAtUtc: record.createdAt.toISOString(),
    expiresAtUtc: record.expiresAt.toISOString(),
    acknowledgedAtUtc: record.acknowledgedAt?.toISOString() ?? null,
  };
}
