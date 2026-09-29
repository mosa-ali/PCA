import type { OpaqueFamilyId } from './types.js';

/**
 * The family's monotonic acceptance floors, as advanced by every
 * successfully appended epoch (see TrustSetEpochStore.appendAcceptedEpoch):
 * a later acceptance must never admit a trust-set epoch at or below the
 * trust-set floor, nor a key epoch below the key floor.
 */
export interface FamilyEpochFloors {
  minimumAcceptedTrustSetEpoch: number;
  minimumAcceptedKeyEpoch: number;
}

/**
 * Read-only view of the family's acceptance floors, for future
 * acceptance/floor checks. This interface deliberately has NO writer: the
 * floors are advanced only inside TrustSetEpochStore.appendAcceptedEpoch,
 * atomically with the epoch insert, so floors can never diverge from the
 * accepted epochs they were derived from.
 */
export interface EpochFloorStore {
  /**
   * The family's current floors, or `null` ONLY when no accepted epoch has
   * ever been persisted for the family (the floors row is created by the
   * first append attempt, so a family with zero appends has no row). A
   * read failure must throw, never be reported as `null`.
   */
  readFloors(familyId: OpaqueFamilyId): Promise<FamilyEpochFloors | null>;
}
