import type { FamilyAuditRecord } from './FamilyAuditStore.js';

/** Everything the crypto boundary needs to encrypt one FamilyAuditRecord for one specific recipient parent device. */
export interface FamilyAuditEventCompositionInput {
  readonly record: FamilyAuditRecord;
  readonly parentDeviceId: string;
  readonly keyEpoch: number;
}

export interface OpaqueFamilyAuditEventPayload {
  readonly encryptedPayloadB64: string;
  readonly nonceB64: string;
}

export type OpaqueFamilyAuditEventComposer = (
  input: FamilyAuditEventCompositionInput,
) => Promise<OpaqueFamilyAuditEventPayload>;

/**
 * PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW (doc 09 PCA-DEC-020).
 *
 * Mirrors alerts/RejectingOpaqueProtectionAlertComposer.ts exactly, applied
 * to audit-event delivery instead of protection alerts -- the SAME shared
 * crypto gate as every other signed/encrypted-payload path in this codebase
 * (device-session issuance, envelope acceptance, protection alerts, Safe
 * Zone, screen-time/apps policy). This is the PRODUCTION default wired into
 * main.ts until a reviewed composer replaces it: every composition attempt
 * fails closed by rejecting, never by returning a plausible-looking empty
 * or placeholder payload. FamilyAuditEventProducer.produce awaits this
 * composer directly and wraps every call in a non-blocking try/catch (audit
 * DELIVERY is best-effort; the underlying FamilyAuditRecord this envelope
 * would describe has already been durably recorded by FamilyAuditService
 * before this composer is ever called) -- so a rejection here means exactly
 * what it should: no audit envelope is ever delivered in production today,
 * while the audit record itself still commits correctly. That is the
 * honest state, not a bug to work around. DO NOT replace this with a
 * composer that returns fabricated ciphertext or any other shortcut.
 */
export function createRejectingOpaqueFamilyAuditEventComposer(): OpaqueFamilyAuditEventComposer {
  return async () => {
    throw new Error('PCA-DEC-020: no reviewed production audit-event-payload composer is available yet.');
  };
}
