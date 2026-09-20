import type { InvitedFamilyRole, OpaqueAccountId, OpaqueFamilyId } from './types.js';
import type { PoolConnection } from 'mysql2/promise';

export type FamilyMembershipRole = 'ADMINISTRATOR' | 'VIEWER' | 'CHILD';
export type FamilyMembershipStatus = 'ACTIVE' | 'REVOKED';

export interface FamilyMembershipRepository {
  /** Creates the normal application role for a successfully completed family genesis. */
  createGenesisAdministrator(accountId: OpaqueAccountId, serviceAccountId: string, familyId: OpaqueFamilyId, now: Date): Promise<void>;
  /** Applies the invitation's role to the active membership after acceptance. */
  applyAcceptedInvitationRole(accountId: OpaqueAccountId, serviceAccountId: string | null, familyId: OpaqueFamilyId, role: InvitedFamilyRole, now: Date): Promise<void>;
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
