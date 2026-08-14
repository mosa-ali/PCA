import type { AttestationId, FamilyAuthorityChainHead, FamilyOwnerAttestation } from './types.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';

export type AppendAttestationResult = 'APPENDED' | 'REJECTED_STALE_REVISION';

/**
 * The append-only attestation ledger plus its single mutable "current head"
 * pointer per family. The ledger rows themselves are never updated after
 * insert; only the head pointer moves, and only via
 * `appendIfCurrentRevision`'s atomic compare-and-swap (mission Section
 * 25/27: at most one concurrent transition may become canonical).
 */
export interface FamilyAuthorityAttestationChainStore {
  /**
   * Inserts `attestation` (keyed by `attestationId`) and advances the
   * family's head pointer to it, IFF the store's current head revision for
   * this family equals `expectedPreviousRevision` (0 meaning "no head
   * yet" -- used only for the genesis self-attestation). Implementations
   * MUST perform the revision check and the pointer advance atomically
   * (e.g. a single guarded UPDATE, mirroring
   * MySqlDeviceChallengeRepository.consumeAtomically) so two concurrent
   * transitions racing from the same prior revision can never both win.
   */
  appendIfCurrentRevision(
    attestation: FamilyOwnerAttestation,
    attestationId: AttestationId,
    expectedPreviousRevision: number,
  ): Promise<AppendAttestationResult>;

  findHead(familyId: OpaqueFamilyId): Promise<FamilyAuthorityChainHead | null>;

  findAttestationById(familyId: OpaqueFamilyId, attestationId: AttestationId): Promise<FamilyOwnerAttestation | null>;

  /**
   * Marks the family's current head REVOKED in place (mission Section 13) --
   * the pointer itself does not move (no new attestation exists), so a
   * subsequent resolveCurrentOwner call for this family must see
   * STALE_OR_REVOKED, never OWNER_AUTHORIZED, until a new attestation is
   * appended. Idempotent: revoking an already-revoked head is a no-op.
   */
  markHeadRevoked(familyId: OpaqueFamilyId, revokedAt: Date): Promise<void>;
}
