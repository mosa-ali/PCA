// Parent-side decryption boundary for an opaque family-audit-event envelope
// (backend/src/familyrbac/FamilyAuditEventLedger.ts). Mirrors
// schedulePolicyAuthoring.ts's SchedulePolicyFamilyEncryptionBoundary in
// reverse (decrypt, not encrypt) -- the reviewed encryption boundary is the
// seam responsible for the actual crypto once it exists; this file
// deliberately selects no unapproved KDF/AEAD/KEM construction.
import type { AuditEntrySummary } from '../domain/types';

export interface OpaqueFamilyAuditEnvelope {
  envelopeId: string;
  encryptedPayloadB64: string;
  nonceB64: string;
  keyEpoch: number;
  generatedAtUtc: string;
}

/** The only parent-side boundary allowed to turn an opaque envelope into a readable AuditEntrySummary. */
export interface FamilyAuditEnvelopeDecryptionBoundary {
  decrypt(envelope: OpaqueFamilyAuditEnvelope): Promise<AuditEntrySummary>;
}

/** Deliberate fail-closed adapter until the reviewed family crypto suite is available -- see FamilyAuditEventComposer.ts's backend-side counterpart for the full CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW rationale. DO NOT replace with a decoder that fabricates plausible-looking plaintext. */
export class UnavailableFamilyAuditEnvelopeDecryptionBoundary implements FamilyAuditEnvelopeDecryptionBoundary {
  async decrypt(): Promise<AuditEntrySummary> {
    throw new Error('CRYPTO_REVIEW_REQUIRED: no reviewed production audit-event decryption boundary is available yet.');
  }
}
