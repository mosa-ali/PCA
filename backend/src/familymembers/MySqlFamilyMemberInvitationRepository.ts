import { execute, runInTransaction } from '../db/pool.js';
import type { AcceptResult, FamilyMemberInvitationRepository } from './FamilyMemberInvitationRepository.js';
import type { FamilyMemberInvitationId, FamilyMemberInvitationRecord, FamilyMemberInvitationStatus, OpaqueAccountId, OpaqueFamilyId } from './types.js';

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
   * Single atomic UPDATE guarded by the current status/expiry, not a
   * read-then-write pair -- same "guarded UPDATE, disambiguating SELECT on
   * zero rows affected" pattern as MySqlInvitationRepository.redeemAtomically.
   * Under concurrent acceptance attempts, InnoDB row-level locking
   * serializes the competing UPDATEs; the loser's WHERE clause re-evaluates
   * against the winner's already-committed row and matches zero rows.
   */
  async acceptAtomically(invitationId: FamilyMemberInvitationId, acceptedByAccountId: OpaqueAccountId, acceptedAt: Date): Promise<AcceptResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE family_member_invitations
         SET status = 'ACCEPTED', accepted_at = ?, accepted_by_account_id = ?
         WHERE invitation_id = ? AND status = 'PENDING' AND expires_at > ?`,
        [acceptedAt, acceptedByAccountId, invitationId, acceptedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<FamilyMemberInvitationRow>(
          conn,
          `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
          [invitationId],
        );
        return { outcome: 'ACCEPTED', record: mapRow(reread.rows[0]!) };
      }

      const current = await execute<FamilyMemberInvitationRow>(
        conn,
        `SELECT * FROM family_member_invitations WHERE invitation_id = ?`,
        [invitationId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
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
}
