import { runInTransaction } from '../db/pool.js';
import type { InvitationRepository, RedemptionResult } from './InvitationRepository.js';
import type { InvitationId, InvitationRecord } from './types.js';

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

export class PostgresInvitationRepository implements InvitationRepository {
  async create(record: InvitationRecord): Promise<void> {
    await runInTransaction(async (client) => {
      await client.query(
        `INSERT INTO enrollment_invitations
           (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at, opened_at, redeemed_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
    const { rows } = await runInTransaction((client) =>
      client.query<InvitationRow>(`SELECT * FROM enrollment_invitations WHERE token_hash = $1`, [tokenHash]),
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async markOpened(invitationId: InvitationId, openedAt: Date): Promise<InvitationRecord> {
    return runInTransaction(async (client) => {
      const updated = await client.query<InvitationRow>(
        `UPDATE enrollment_invitations SET status = 'OPENED', opened_at = $2
         WHERE invitation_id = $1 AND status = 'CREATED'
         RETURNING *`,
        [invitationId, openedAt],
      );
      if (updated.rows[0]) return mapRow(updated.rows[0]);
      const current = await client.query<InvitationRow>(
        `SELECT * FROM enrollment_invitations WHERE invitation_id = $1`,
        [invitationId],
      );
      if (!current.rows[0]) throw new Error('invitation not found');
      return mapRow(current.rows[0]);
    });
  }

  /**
   * Single atomic UPDATE guarded by the current status/expiry, not a
   * read-then-write pair. Under concurrent redemption attempts, Postgres
   * row-level locking serializes the competing UPDATEs; the loser's WHERE
   * clause re-evaluates against the winner's already-committed row and
   * matches zero rows, so it falls through to the disambiguating SELECT
   * below rather than double-redeeming.
   */
  async redeemAtomically(invitationId: InvitationId, redeemedAt: Date): Promise<RedemptionResult> {
    return runInTransaction(async (client) => {
      const updated = await client.query<InvitationRow>(
        `UPDATE enrollment_invitations
         SET status = 'REDEEMED', redeemed_at = $2
         WHERE invitation_id = $1 AND status IN ('CREATED', 'OPENED') AND expires_at > $2
         RETURNING *`,
        [invitationId, redeemedAt],
      );
      if (updated.rows[0]) return { outcome: 'REDEEMED', record: mapRow(updated.rows[0]) };

      const current = await client.query<InvitationRow>(
        `SELECT * FROM enrollment_invitations WHERE invitation_id = $1`,
        [invitationId],
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'NOT_FOUND' };
      if (row.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (row.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
      return { outcome: 'EXPIRED' };
    });
  }

  async revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord> {
    return runInTransaction(async (client) => {
      const updated = await client.query<InvitationRow>(
        `UPDATE enrollment_invitations SET status = 'REVOKED', revoked_at = $2
         WHERE invitation_id = $1 AND status != 'REVOKED'
         RETURNING *`,
        [invitationId, revokedAt],
      );
      if (updated.rows[0]) return mapRow(updated.rows[0]);
      const current = await client.query<InvitationRow>(
        `SELECT * FROM enrollment_invitations WHERE invitation_id = $1`,
        [invitationId],
      );
      if (!current.rows[0]) throw new Error('invitation not found');
      return mapRow(current.rows[0]);
    });
  }
}
