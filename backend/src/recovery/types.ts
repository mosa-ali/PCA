export type OpaqueFamilyId = string;

/**
 * PCA-DEC-006: no support master key. The server holds only an opaque
 * encrypted recovery envelope produced entirely client-side -- it never
 * sees the plaintext family root recovery secret and cannot decrypt this
 * blob itself. `version` is an optimistic-concurrency token: a replace must
 * present the version it read, so two concurrent replacements can't
 * silently clobber one another.
 */
export interface RecoveryEnvelopeRecord {
  familyId: OpaqueFamilyId;
  ciphertext: Buffer;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
