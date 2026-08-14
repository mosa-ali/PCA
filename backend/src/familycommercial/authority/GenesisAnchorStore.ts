import type { FamilyAuthorityGenesisAnchor } from './types.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';

/**
 * Append-only: a family has exactly one genesis anchor, ever. `createIfAbsent`
 * is the ONLY write this interface exposes -- there is no update/delete,
 * because the genesis anchor is never a mutable `currentRole = OWNER` row
 * (mission Section 5/24).
 */
export interface FamilyAuthorityGenesisStore {
  /**
   * Inserts `anchor` iff no genesis anchor exists yet for `anchor.familyId`.
   * Returns whichever anchor is now canonical: the caller's own row if it
   * won the race, or the pre-existing row if a concurrent bootstrap attempt
   * already won -- see MySqlFamilyAuthorityGenesisStore's unique-key
   * handling (mission Section 26: exactly one canonical genesis, no two
   * roots, other attempts get a stable/idempotent result rather than a
   * second root).
   */
  createIfAbsent(anchor: FamilyAuthorityGenesisAnchor): Promise<FamilyAuthorityGenesisAnchor>;

  findByFamilyId(familyId: OpaqueFamilyId): Promise<FamilyAuthorityGenesisAnchor | null>;
}
