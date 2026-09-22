import { execute, runInTransaction } from '../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';
import type { FamilyBindingOutcome } from './FamilyMemberInvitationRepository.js';
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
 * accepting a second invitation. Because that containment is expressed in the
 * UPDATE's own WHERE clause, it is a genuine serialization point: two
 * transactions racing to bind the same unbound account contend on the same row
 * lock, and the loser re-evaluates `family_id IS NULL` against the winner's
 * committed row and matches nothing. tryBindAccountToFamilyOnConnection turns
 * "matched nothing" into a returned verdict; bindAccountToFamily, which runs
 * after its caller's transaction has already committed, can only leave the
 * discrimination to whoever called it (see its own note below).
 */
export class MySqlFamilyMemberAccountBinder implements FamilyMemberAccountBinder {
  constructor(private readonly membershipRepository: FamilyMembershipRepository = new MySqlFamilyMembershipRepository()) {}

  /**
   * `_now` is unused today -- reserved for a future updated_at-style column; parent_accounts has none today.
   *
   * Kept for callers that must bind OUTSIDE any transaction they own. It cannot
   * report a conflict, because by the time it returns the caller's own
   * transaction has committed and nothing can be rolled back; prefer
   * tryBindAccountToFamilyOnConnection wherever a conflict is still actionable.
   */
  async bindAccountToFamily(accountId: OpaqueAccountId, familyId: OpaqueFamilyId, now: Date, role: InvitedFamilyRole): Promise<void> {
    await runInTransaction(async (conn) => {
      await this.tryBindAccountToFamilyOnConnection(conn, accountId, familyId, now, role);
    });
  }

  /**
   * PCA-DEC-036. Opens NO transaction of its own: it runs on the caller's
   * connection, inside the caller's transaction, so the guarded UPDATE below
   * and whatever the caller already wrote commit or abort as one unit. The
   * caller decides what a refusal means -- here that is "roll back", which is
   * how the invitation row and the parent-member seat are un-consumed.
   *
   * WHY THE UPDATE IS THE DECISION, NOT A PRECEDING SELECT: the
   * `family_id IS NULL` predicate is evaluated by InnoDB under the row lock, so
   * a competing `UPDATE ... WHERE family_id IS NULL` either waits for this
   * transaction or finds the guard already false. A SELECT-then-UPDATE pair
   * would let both racers read NULL, which is the TOCTOU the owner ruled
   * insufficient.
   *
   * `ALREADY_BOUND_TO_THIS_FAMILY` is a SUCCESS, not a refusal: it is the
   * re-invite-an-existing-member flow (the only way to offer someone a
   * different role), and the role write below still has to happen.
   */
  async tryBindAccountToFamilyOnConnection(
    conn: PoolConnection,
    accountId: OpaqueAccountId,
    familyId: OpaqueFamilyId,
    now: Date,
    role: InvitedFamilyRole,
  ): Promise<FamilyBindingOutcome> {
    const update = await execute(conn, `UPDATE parent_accounts SET family_id = ? WHERE account_id = ? AND family_id IS NULL`, [familyId, accountId]);
    // Read back under a lock rather than trusting rowCount alone, exactly as the
    // pre-existing bind did: rowCount === 0 is ambiguous between "this family"
    // and "another family", and only the value resolves it. A missing row lands
    // in the refusal branch too -- unreachable in practice, since the
    // acceptance's own guarded UPDATE inner-joins this very account, so a
    // nonexistent account can never reach a call here; failing closed is the
    // safe reading of "cannot establish that this account is unbound".
    const { rows } = await execute<{ service_account_id: string | null; family_id: string | null }>(
      conn,
      `SELECT service_account_id, family_id FROM parent_accounts WHERE account_id = ? FOR UPDATE`,
      [accountId],
    );
    const boundFamilyId = rows[0]?.family_id ?? null;
    if (boundFamilyId !== familyId) return 'BOUND_TO_ANOTHER_FAMILY';
    // The invitation role is the source for the active membership role; it is
    // never inferred from account_type or from a client-side session value.
    await this.membershipRepository.applyAcceptedInvitationRoleOnConnection(conn, accountId, rows[0]!.service_account_id, familyId, role, now);
    return update.rowCount > 0 ? 'BOUND' : 'ALREADY_BOUND_TO_THIS_FAMILY';
  }
}
