import { execute, runInTransaction } from '../db/pool.js';
import type {
  AcceptResult,
  AcceptTransactionHook,
  FamilyMemberInvitationRepository,
  RemoveMemberResult,
  RemoveMemberTransactionHook,
} from './FamilyMemberInvitationRepository.js';
import type { FamilyMemberInvitationId, FamilyMemberInvitationRecord, FamilyMemberInvitationStatus, InvitedFamilyRole, OpaqueAccountId, OpaqueFamilyId } from './types.js';

interface FamilyMemberInvitationRow {
  invitation_id: string;
  family_id: string;
  invited_email_hash: Buffer;
  role: FamilyMemberInvitationRecord['role'];
  status: FamilyMemberInvitationStatus;
  invited_by_account_id: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  expired_at: Date | null;
  revoked_at: Date | null;
  accepted_by_account_id: string | null;
}

const TERMINAL_STATUSES: ReadonlySet<FamilyMemberInvitationStatus> = new Set(['ACCEPTED', 'EXPIRED', 'REVOKED']);

function mapRow(row: FamilyMemberInvitationRow): FamilyMemberInvitationRecord {
  return {
    invitationId: row.invitation_id,
    familyId: row.family_id,
    invitedEmailHash: row.invited_email_hash,
    role: row.role,
    status: row.status,
    invitedByAccountId: row.invited_by_account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    expiredAt: row.expired_at,
    revokedAt: row.revoked_at,
    acceptedByAccountId: row.accepted_by_account_id,
  };
}

export class MySqlFamilyMemberInvitationRepository implements FamilyMemberInvitationRepository {
  async create(record: FamilyMemberInvitationRecord): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO family_member_invitations
           (invitation_id, family_id, invited_email_hash, role, status, invited_by_account_id,
            created_at, expires_at, accepted_at, expired_at, revoked_at, accepted_by_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.invitationId,
          record.familyId,
          record.invitedEmailHash,
          record.role,
          record.status,
          record.invitedByAccountId,
          record.createdAt,
          record.expiresAt,
          record.acceptedAt,
          record.expiredAt,
          record.revokedAt,
          record.acceptedByAccountId,
        ],
      ),
    );
  }

  async findByIdForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId): Promise<FamilyMemberInvitationRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      ),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findPendingByFamilyAndEmailHash(familyId: OpaqueFamilyId, invitedEmailHash: Buffer): Promise<FamilyMemberInvitationRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE family_id = ? AND invited_email_hash = ? AND status = 'PENDING'
         ORDER BY created_at DESC LIMIT 1`,
        [familyId, invitedEmailHash],
      ),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listForFamily(familyId: OpaqueFamilyId): Promise<FamilyMemberInvitationRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE family_id = ? ORDER BY created_at DESC`,
        [familyId],
      ),
    );
    return rows.map(mapRow);
  }

  /**
   * Single atomic UPDATE guarded by the current status/expiry AND by the
   * accepting account's own identity, not a read-then-write pair -- same
   * "guarded UPDATE, disambiguating SELECT on zero rows affected" pattern
   * as MySqlInvitationRepository.redeemAtomically. Under concurrent
   * acceptance attempts, InnoDB row-level locking serializes the competing
   * UPDATEs; the loser's WHERE clause re-evaluates against the winner's
   * already-committed row and matches zero rows.
   *
   * IDENTITY BINDING: the UPDATE joins `parent_accounts` on the accepting
   * account and requires `invited_email_hash = email_hash`, so an
   * invitation can only ever be accepted by the very address it was issued
   * to. This is a narrowly-scoped, read-only cross-domain reference to
   * parent_accounts -- exactly the precedent MySqlFamilyMemberAccountBinder
   * already establishes for this domain (see its own doc comment), only
   * read instead of write, and expressed as a JOIN inside the single
   * guarded statement precisely so the binding cannot be raced against a
   * concurrent acceptance the way a preceding SELECT could be. Both columns
   * are BINARY(32) SHA-256 digests of the same normalized-lowercase address
   * (migrations 0013/0027; familymembers/emailHash.ts and
   * parentaccount/emailHash.ts compute the identical digest).
   *
   * `onAcceptedInTransaction` runs on the same connection before COMMIT --
   * see AcceptTransactionHook.
   */
  async acceptAtomically(
    invitationId: FamilyMemberInvitationId,
    acceptedByAccountId: OpaqueAccountId,
    acceptedAt: Date,
    onAcceptedInTransaction?: AcceptTransactionHook,
  ): Promise<AcceptResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE family_member_invitations AS invitation
           JOIN parent_accounts AS accepting_account ON accepting_account.account_id = ?
         SET invitation.status = 'ACCEPTED', invitation.accepted_at = ?, invitation.accepted_by_account_id = ?
         WHERE invitation.invitation_id = ? AND invitation.status = 'PENDING' AND invitation.expires_at > ?
           AND invitation.invited_email_hash = accepting_account.email_hash`,
        [acceptedByAccountId, acceptedAt, acceptedByAccountId, invitationId, acceptedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<FamilyMemberInvitationRow>(
          conn,
          `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
          [invitationId],
        );
        const record = mapRow(reread.rows[0]!);
        if (onAcceptedInTransaction) {
          // SEAT IS PER MEMBER, NOT PER ACCEPTANCE. createInvitation's only
          // duplicate guard is "no PENDING invitation for this address", so
          // re-inviting someone who already accepted is allowed (it is in
          // fact the only way to offer an existing member a different role,
          // since changeInvitationRole refuses anything not PENDING). Without
          // this check that second acceptance would charge a second seat for
          // the same person while accountBinder -- documented idempotent --
          // changes no membership at all, permanently burning a seat the
          // family paid for. Counted on the transaction's own connection so
          // it sees the row this statement just flipped.
          const priorAcceptances = await execute<{ prior: number }>(
            conn,
            `SELECT COUNT(*) AS prior FROM family_member_invitations
              WHERE family_id = ? AND accepted_by_account_id = ? AND status = 'ACCEPTED' AND invitation_id <> ?`,
            [record.familyId, acceptedByAccountId, invitationId],
          );
          if (Number(priorAcceptances.rows[0]?.prior ?? 0) === 0) {
            await onAcceptedInTransaction(conn, record);
          }
        }
        return { outcome: 'ACCEPTED', record };
      }

      const current = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
        [invitationId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };

      // Identity check BEFORE any state disambiguation: someone this
      // invitation was not addressed to must not be able to learn that it
      // exists, let alone whether it is pending/revoked/expired.
      const account = await execute<{ email_hash: Buffer }>(
        conn,
        `SELECT email_hash FROM parent_accounts WHERE account_id = ?`,
        [acceptedByAccountId],
      );
      const accountEmailHash = account.rows[0]?.email_hash;
      if (!accountEmailHash || Buffer.compare(accountEmailHash, row.invited_email_hash) !== 0) {
        return { outcome: 'NOT_FOUND' };
      }

      if (row.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (row.status === 'ACCEPTED') return { outcome: 'ALREADY_ACCEPTED' };
      return { outcome: 'EXPIRED' };
    });
  }

  async revokeForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, revokedAt: Date): Promise<FamilyMemberInvitationRecord | null> {
    return runInTransaction(async (conn) => {
      const before = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      );
      if (!before.rows[0]) return null;
      await execute(
        conn,
        `UPDATE family_member_invitations SET status = 'REVOKED', revoked_at = ?
         WHERE invitation_id = ? AND family_id = ? AND status NOT IN ('REVOKED', 'ACCEPTED')`,
        [revokedAt, invitationId, familyId],
      );
      const current = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      );
      return current.rows[0] ? mapRow(current.rows[0]) : null;
    });
  }

  async updateRoleForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, newRole: InvitedFamilyRole): Promise<FamilyMemberInvitationRecord | null> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE family_member_invitations SET role = ?
         WHERE invitation_id = ? AND family_id = ? AND status = 'PENDING'`,
        [newRole, invitationId, familyId],
      );
      const current = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ? AND family_id = ? AND status = 'PENDING'`,
        [invitationId, familyId],
      );
      return current.rows[0] ? mapRow(current.rows[0]) : null;
    });
  }

  async expireIfDue(invitationId: FamilyMemberInvitationId, at: Date): Promise<FamilyMemberInvitationRecord> {
    return runInTransaction(async (conn) => {
      const before = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
        [invitationId],
      );
      const beforeRow = before.rows[0];
      if (!beforeRow) throw new Error('family member invitation not found');
      if (TERMINAL_STATUSES.has(beforeRow.status) || beforeRow.expires_at.getTime() > at.getTime()) {
        return mapRow(beforeRow);
      }
      await execute(
        conn,
        `UPDATE family_member_invitations SET status = 'EXPIRED', expired_at = ?
         WHERE invitation_id = ? AND status = 'PENDING' AND expires_at <= ?`,
        [at, invitationId, at],
      );
      const reread = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
        [invitationId],
      );
      return mapRow(reread.rows[0]!);
    });
  }

  /**
   * Single atomic UPDATE guarded by (a) the target actually being bound to
   * this family right now and (b) an EXISTS check that the target IS a
   * non-owner member -- i.e. holds an ACCEPTED family_member_invitations
   * row into this family. An account bound to the family with NO such row
   * (the Owner, by construction -- see removeMemberAtomically's own
   * interface doc comment) fails this EXISTS check, so the UPDATE affects
   * zero rows and the post-failure disambiguation below reports
   * CANNOT_REMOVE_OWNER. Same "guarded UPDATE, disambiguating SELECT on
   * zero rows affected" pattern as acceptAtomically above, in reverse.
   */
  /** `_removedAt` is unused here today -- parent_accounts has no updated_at-style column (see MySqlFamilyMemberAccountBinder's own `_now` precedent); it exists purely so the service can pass one consistent timestamp through to both this call and the entitlement adjustment's `now`. */
  async removeMemberAtomically(
    familyId: OpaqueFamilyId,
    targetAccountId: OpaqueAccountId,
    _removedAt: Date,
    onRemovedInTransaction?: RemoveMemberTransactionHook,
  ): Promise<RemoveMemberResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE parent_accounts
           SET family_id = NULL
         WHERE account_id = ? AND family_id = ?
           AND EXISTS (
             SELECT 1 FROM family_member_invitations AS fmi
              WHERE fmi.family_id = ? AND fmi.accepted_by_account_id = parent_accounts.account_id AND fmi.status = 'ACCEPTED'
           )`,
        [targetAccountId, familyId, familyId],
      );
      if (updated.rowCount > 0) {
        if (onRemovedInTransaction) await onRemovedInTransaction(conn, familyId, targetAccountId);
        return { outcome: 'REMOVED' };
      }

      // Disambiguate a zero-row UPDATE, mirroring acceptAtomically's own
      // post-failure SELECT exactly: unknown account, a member of a
      // different (or no) family, or -- the only remaining possibility
      // given the WHERE clause above -- this family's Owner.
      const current = await execute<{ account_id: string; family_id: string | null }>(
        conn,
        `SELECT account_id, family_id FROM parent_accounts WHERE account_id = ?`,
        [targetAccountId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.family_id !== familyId) return { outcome: 'NOT_A_MEMBER' };
      return { outcome: 'CANNOT_REMOVE_OWNER' };
    });
  }
}
