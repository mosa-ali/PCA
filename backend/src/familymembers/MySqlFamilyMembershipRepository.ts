import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import type { InvitedFamilyRole, OpaqueAccountId, OpaqueFamilyId } from './types.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from './FamilyMembershipRepository.js';

interface RoleRow {
  role: FamilyMembershipRole;
}

export class MySqlFamilyMembershipRepository implements FamilyMembershipRepository {
  async applyAcceptedInvitationRoleOnConnection(
    conn: import('mysql2/promise').PoolConnection,
    accountId: OpaqueAccountId,
    serviceAccountId: string | null,
    familyId: OpaqueFamilyId,
    role: InvitedFamilyRole,
    now: Date,
  ): Promise<void> {
    await execute(
        conn,
        `INSERT INTO family_parent_memberships
           (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
         ON DUPLICATE KEY UPDATE
           service_account_id = COALESCE(VALUES(service_account_id), service_account_id),
           role = VALUES(role),
           status = 'ACTIVE',
           updated_at = VALUES(updated_at)`,
        [randomUUID(), familyId, accountId, serviceAccountId, role, now, now],
      );
  }

  async findActiveRole(accountId: OpaqueAccountId, familyId: OpaqueFamilyId): Promise<FamilyMembershipRole | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<RoleRow>(
        conn,
        `SELECT role FROM family_parent_memberships
         WHERE account_id = ? AND family_id = ? AND status = 'ACTIVE'`,
        [accountId, familyId],
      ),
    );
    return rows[0]?.role ?? null;
  }
}
