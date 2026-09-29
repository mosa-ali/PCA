import type { OpaqueFamilyId } from './types.js';

/**
 * The family's canonical current key-epoch state, DERIVED from the latest
 * accepted signed epoch row (highest trustSetEpoch) -- never from a
 * candidate, proposed or caller-supplied value. Both numbers belong to the
 * same accepted epoch row; they are returned together so a consumer can
 * never pair a trust-set epoch from one row with a key epoch from another.
 */
export interface CanonicalKeyEpoch {
  trustSetEpoch: number;
  keyEpoch: number;
}

/**
 * Read-only view of the family's canonical key epoch, for future
 * acceptance/floor checks. This interface deliberately has NO writer: the
 * only writes to the underlying store go through
 * TrustSetEpochStore.appendAcceptedEpoch, so the canonical key epoch can
 * never be advanced without a fully accepted signed epoch behind it.
 */
export interface KeyEpochStore {
  /**
   * `{ trustSetEpoch, keyEpoch }` of the latest accepted signed epoch, or
   * `null` ONLY when no accepted epoch has ever been persisted for the
   * family. A read failure must throw, never be reported as `null` (a
   * false "no epoch" answer would invite a caller to treat a family as
   * never-initialized).
   */
  readCanonicalKeyEpoch(familyId: OpaqueFamilyId): Promise<CanonicalKeyEpoch | null>;
}
