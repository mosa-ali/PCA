import { execute, runInTransaction } from '../db/pool.js';
import type { InvitationRepository, RedemptionResult } from './InvitationRepository.js';
import type { InvitationId, InvitationRecord, OpaqueFamilyId } from './types.js';

interface InvitationRow {
  invitation_id: string;
  family_id: string;
  token_hash: string;
  platform: InvitationRecord['platform'];
  requested_protection_mode: InvitationRecord['requestedProtectionMode'];
  status: InvitationRecord['status'];
  created_at: Date;
  expires_at: Date;
  opened_at: Date | null;
  redeemed_at: Date | null;
  revoked_at: Date | null;
}

function mapRow(row: InvitationRow): InvitationRecord {
  return {
    invitationId: row.invitation_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    platform: row.platform,
    requestedProtectionMode: row.requested_protection_mode,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    openedAt: row.opened_at,
    redeemedAt: row.redeemed_at,
    revokedAt: row.revoked_at,
  };
}

export class MySqlInvitationRepository implements InvitationRepository {
  async create(record: InvitationRecord): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO enrollment_invitations
           (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at, opened_at, redeemed_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.invitationId,
          record.familyId,
          record.tokenHash,
          record.platform,
          record.requestedProtectionMode,
          record.status,
          record.createdAt,
          record.expiresAt,
          record.openedAt,
          record.redeemedAt,
          record.revokedAt,
        ],
      );
    });
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE token_hash = ?`, [tokenHash]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByIdForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ? AND family_id = ?`, [
        invitationId,
        familyId,
      ]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listForFamily(familyId: OpaqueFamilyId): Promise<InvitationRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE family_id = ? ORDER BY created_at DESC`, [
        familyId,
      ]),
    );
    return rows.map(mapRow);
  }

  async markOpened(invitationId: InvitationId, openedAt: Date): Promise<InvitationRecord> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'OPENED', opened_at = ?
         WHERE invitation_id = ? AND status = 'CREATED'`,
        [openedAt, invitationId],
      );
      const current = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      if (!current.rows[0]) throw new Error('invitation not found');
      return mapRow(current.rows[0]);
    });
  }

  /**
   * Single atomic UPDATE guarded by the current status/expiry, not a
   * read-then-write pair. Under concurrent redemption attempts, InnoDB
   * row-level locking serializes the competing UPDATEs; the loser's WHERE
   * clause re-evaluates against the winner's already-committed row and
   * matches zero rows, so it falls through to the disambiguating SELECT
   * below rather than double-redeeming.
   */
  async redeemAtomically(invitationId: InvitationId, redeemedAt: Date): Promise<RedemptionResult> {
    return runInTransaction(async (conn) => {
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations
         SET status = 'REDEEMED', redeemed_at = ?
         WHERE invitation_id = ? AND status IN ('CREATED', 'OPENED') AND expires_at > ?`,
        [redeemedAt, invitationId, redeemedAt],
      );
      if (updated.rowCount > 0) {
        const reread = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
          invitationId,
        ]);
        return { outcome: 'REDEEMED', record: mapRow(reread.rows[0]!) };
      }

      const current = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (row.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
      return { outcome: 'EXPIRED' };
    });
  }

  async revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'REVOKED', revoked_at = ?
         WHERE invitation_id = ? AND status NOT IN ('REVOKED', 'REDEEMED')`,
        [revokedAt, invitationId],
      );
      const current = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      if (!current.rows[0]) throw new Error('invitation not found');
      return mapRow(current.rows[0]);
    });
  }

  async revokeForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord | null> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'REVOKED', revoked_at = ?
         WHERE invitation_id = ? AND family_id = ? AND status NOT IN ('REVOKED', 'REDEEMED')`,
        [revokedAt, invitationId, familyId],
      );
      const current = await execute<InvitationRow>(
        conn,
        `SELECT * FROM enrollment_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      );
      return current.rows[0] ? mapRow(current.rows[0]) : null;
    });
  }
}
