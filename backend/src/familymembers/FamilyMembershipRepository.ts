import type { InvitedFamilyRole, OpaqueAccountId, OpaqueFamilyId } from './types.js';
import type { PoolConnection } from 'mysql2/promise';

export type FamilyMembershipRole = 'ADMINISTRATOR' | 'VIEWER' | 'CHILD';
export type FamilyMembershipStatus = 'ACTIVE' | 'REVOKED';

export interface FamilyMembershipRepository {
  /**
   * The ONLY way a Parent Web membership is written.
   *
   * It takes the CALLER's connection and opens no transaction of its own, so
   * membership persistence participates in whatever atomic transaction the
   * caller already owns. That is the whole point of the connection parameter:
   * a variant that began its own transaction would commit membership separately
   * from the acceptance (or the genesis) it belongs to, which is strictly worse
   * for integrity than sharing one.
   *
   * The non-connection variants `createGenesisAdministrator` and
   * `applyAcceptedInvitationRole` were DELETED rather than kept for convenience
   * (owner ruling FAMILY_MEMBERSHIP_REPOSITORY_OWNER_DECISION =
   * DELETE_DEAD_WRAPPERS). Neither had a production caller, and both opened their
   * OWN transaction -- so a caller reaching for them would have silently split
   * an atomic operation in two. Genesis keeps its own in-transaction write in
   * MySqlGenesisTransactionRepository.
   */
  applyAcceptedInvitationRoleOnConnection(
    conn: PoolConnection,
    accountId: OpaqueAccountId,
    serviceAccountId: string | null,
    familyId: OpaqueFamilyId,
    role: InvitedFamilyRole,
    now: Date,
  ): Promise<void>;
  /** Returns only an active normal Parent Web role; missing membership is null. */
  findActiveRole(accountId: OpaqueAccountId, familyId: OpaqueFamilyId): Promise<FamilyMembershipRole | null>;
}
