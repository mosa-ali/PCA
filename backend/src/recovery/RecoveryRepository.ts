import type { OpaqueFamilyId, RecoveryEnvelopeRecord } from './types.js';

export type StoreEnvelopeResult =
  | { outcome: 'STORED'; record: RecoveryEnvelopeRecord }
  | { outcome: 'VERSION_MISMATCH'; currentVersion: number | null };

export type DeleteEnvelopeResult = { outcome: 'DELETED' } | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the opaque family recovery envelope. Only a
 * deterministic in-memory implementation exists today (test support);
 * PostgreSQL persistence is a separate, later slice.
 *
 * Exactly one envelope exists per family, keyed directly by familyId --
 * there is no separate guessable envelope id, so cross-family access is
 * structurally impossible rather than merely checked. storeEnvelope uses
 * optimistic concurrency: the caller supplies the version it last read (0
 * to create a brand-new envelope); a mismatch means someone else replaced
 * the envelope first and the caller must re-read before retrying, rather
 * than silently overwriting newer recovery material.
 */
export interface RecoveryRepository {
  getEnvelope(familyId: OpaqueFamilyId): Promise<RecoveryEnvelopeRecord | null>;
  storeEnvelope(
    familyId: OpaqueFamilyId,
    ciphertext: Buffer,
    expectedVersion: number,
    now: Date,
  ): Promise<StoreEnvelopeResult>;
  deleteEnvelope(familyId: OpaqueFamilyId): Promise<DeleteEnvelopeResult>;
}
