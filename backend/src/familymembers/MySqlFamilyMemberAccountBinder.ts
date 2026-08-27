import { execute, runInTransaction } from '../db/pool.js';
import type { FamilyMemberAccountBinder } from './FamilyMemberInvitationService.js';
import type { OpaqueAccountId, OpaqueFamilyId } from './types.js';

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
  /** `_now` is unused today -- reserved for a future updated_at-style column; parent_accounts has none today. */
  async bindAccountToFamily(accountId: OpaqueAccountId, familyId: OpaqueFamilyId, _now: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_accounts SET family_id = ? WHERE account_id = ? AND family_id IS NULL`, [
        familyId,
        accountId,
      ]),
    );
  }
}
