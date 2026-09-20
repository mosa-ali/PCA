import { execute, runInTransaction } from '../db/pool.js';
import type { FamilyMemberAccountBinder } from './FamilyMemberInvitationService.js';
import type { OpaqueAccountId, OpaqueFamilyId } from './types.js';
import type { FamilyMembershipRepository } from './FamilyMembershipRepository.js';
import { MySqlFamilyMembershipRepository } from './MySqlFamilyMembershipRepository.js';
import type { InvitedFamilyRole } from './types.js';

/**
 * Real implementation of FamilyMemberAccountBinder: a narrowly-scoped
 * direct write against parent_accounts (a table this domain does not own),
 * mirroring ParentAccountRepository.grantFamilyScopeIfAbsent/
 * createFamilyIfAbsent's own precedent for exactly this kind of
 * cross-domain write (see those methods' doc comments in
 * MySqlParentAccountRepository.ts).
 *
 * Only ever sets family_id when it is currently NULL -- an account already
 * bound to a family (its own or another) is never silently reassigned by
 * accepting a second invitation. A caller that needs to detect and surface
 * that conflict to the user reads parent_accounts.family_id itself before
 * calling this.
 */
export class MySqlFamilyMemberAccountBinder implements FamilyMemberAccountBinder {
  constructor(private readonly membershipRepository: FamilyMembershipRepository = new MySqlFamilyMembershipRepository()) {}

  /** `_now` is unused today -- reserved for a future updated_at-style column; parent_accounts has none today. */
  async bindAccountToFamily(accountId: OpaqueAccountId, familyId: OpaqueFamilyId, now: Date, role: InvitedFamilyRole): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(conn, `UPDATE parent_accounts SET family_id = ? WHERE account_id = ? AND family_id IS NULL`, [familyId, accountId]);
    // The invitation role is the source for the active membership role; it is
    // never inferred from account_type or from a client-side session value.
      const { rows } = await execute<{ service_account_id: string | null; family_id: string | null }>(
        conn,
        `SELECT service_account_id, family_id FROM parent_accounts WHERE account_id = ? FOR UPDATE`,
        [accountId],
      );
      if (rows[0]?.family_id === familyId) {
        await this.membershipRepository.applyAcceptedInvitationRoleOnConnection(conn, accountId, rows[0].service_account_id, familyId, role, now);
      }
    });
  }
}
