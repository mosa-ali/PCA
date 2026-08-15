import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../db/pool.js';
import type { InvitationRepository, RedemptionResult, TransitionResult } from './InvitationRepository.js';
import type { InvitationId, InvitationRecord, InvitationStatus, OpaqueFamilyId } from './types.js';

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
  install_required_at: Date | null;
  app_installed_at: Date | null;
  authorization_required_at: Date | null;
  redeemed_at: Date | null;
  expired_at: Date | null;
  revoked_at: Date | null;
}

const TERMINAL_STATUSES: ReadonlySet<InvitationStatus> = new Set(['REDEEMED', 'EXPIRED', 'REVOKED']);

/**
 * Appends one immutable row to enrollment_invitation_transitions
 * (PCA-ADD-ENR-005/023). Always called from inside the same transaction as
 * the enrollment_invitations UPDATE it documents, so the audit row and the
 * state change it describes commit or roll back together atomically.
 */
async function insertTransition(
  conn: PoolConnection,
  invitationId: InvitationId,
  fromStatus: InvitationStatus,
  toStatus: InvitationStatus,
  at: Date,
): Promise<void> {
  await execute(
    conn,
    `INSERT INTO enrollment_invitation_transitions (transition_id, invitation_id, from_status, to_status, transitioned_at)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), invitationId, fromStatus, toStatus, at],
  );
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
    installRequiredAt: row.install_required_at,
    appInstalledAt: row.app_installed_at,
    authorizationRequiredAt: row.authorization_required_at,
    redeemedAt: row.redeemed_at,
    expiredAt: row.expired_at,
    revokedAt: row.revoked_at,
  };
}

export class MySqlInvitationRepository implements InvitationRepository {
  async create(record: InvitationRecord): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO enrollment_invitations
           (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at,
            opened_at, install_required_at, app_installed_at, authorization_required_at, redeemed_at, expired_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          record.installRequiredAt,
          record.appInstalledAt,
          record.authorizationRequiredAt,
          record.redeemedAt,
          record.expiredAt,
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
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'OPENED', opened_at = ?
         WHERE invitation_id = ? AND status = 'CREATED'`,
        [openedAt, invitationId],
      );
      if (updated.rowCount > 0) await insertTransition(conn, invitationId, 'CREATED', 'OPENED', openedAt);
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
      const before = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const beforeRow = before.rows[0];
      // PCA-ADD-ENR-005: redemption is now reachable from ANY non-terminal
      // pre-redemption state, not only CREATED/OPENED -- a device may skip
      // INSTALL_REQUIRED/APP_INSTALLED/AUTHORIZATION_REQUIRED entirely (e.g.
      // the app was already installed and the invitation link was opened
      // directly inside it), and this remains valid.
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations
         SET status = 'REDEEMED', redeemed_at = ?
         WHERE invitation_id = ?
           AND status IN ('CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED', 'AUTHORIZATION_REQUIRED')
           AND expires_at > ?`,
        [redeemedAt, invitationId, redeemedAt],
      );
      if (updated.rowCount > 0) {
        if (beforeRow) await insertTransition(conn, invitationId, beforeRow.status, 'REDEEMED', redeemedAt);
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

  async markInstallRequired(invitationId: InvitationId, at: Date): Promise<TransitionResult> {
    return this.transitionTo(invitationId, 'INSTALL_REQUIRED', ['CREATED', 'OPENED'], at, 'install_required_at');
  }

  async markAppInstalled(invitationId: InvitationId, at: Date): Promise<TransitionResult> {
    return this.transitionTo(
      invitationId,
      'APP_INSTALLED',
      ['CREATED', 'OPENED', 'INSTALL_REQUIRED'],
      at,
      'app_installed_at',
    );
  }

  async markAuthorizationRequired(invitationId: InvitationId, at: Date): Promise<TransitionResult> {
    return this.transitionTo(
      invitationId,
      'AUTHORIZATION_REQUIRED',
      ['CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED'],
      at,
      'authorization_required_at',
    );
  }

  /**
   * Shared implementation for the three forward-progress transitions above.
   * Follows the same "guarded UPDATE, disambiguating SELECT on zero rows
   * affected" pattern as redeemAtomically/revoke, plus an immutable
   * transition-audit INSERT on success (PCA-ADD-ENR-005/023). The pre-UPDATE
   * SELECT's observed `status` is used only as the transition audit's
   * `from_status` label -- correctness of the transition itself rests
   * entirely on the guarded UPDATE's WHERE clause, not on this read.
   */
  private async transitionTo(
    invitationId: InvitationId,
    toStatus: InvitationRecord['status'],
    fromStatuses: readonly InvitationRecord['status'][],
    at: Date,
    atColumn: 'install_required_at' | 'app_installed_at' | 'authorization_required_at',
  ): Promise<TransitionResult> {
    return runInTransaction(async (conn) => {
      const before = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const beforeRow = before.rows[0];
      if (!beforeRow) return { outcome: 'NOT_FOUND' };

      const placeholders = fromStatuses.map(() => '?').join(', ');
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations
         SET status = ?, ${atColumn} = ?
         WHERE invitation_id = ? AND status IN (${placeholders}) AND expires_at > ?`,
        [toStatus, at, invitationId, ...fromStatuses, at],
      );

      if (updated.rowCount > 0) {
        await insertTransition(conn, invitationId, beforeRow.status, toStatus, at);
        const reread = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
          invitationId,
        ]);
        return { outcome: 'TRANSITIONED', record: mapRow(reread.rows[0]!) };
      }

      const current = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const row = current.rows[0]!;
      if (row.status === toStatus) return { outcome: 'ALREADY_IN_STATE', record: mapRow(row) };
      if (row.status === 'REVOKED') return { outcome: 'REVOKED' };
      if (row.status === 'REDEEMED') return { outcome: 'ALREADY_REDEEMED' };
      if (row.status === 'EXPIRED' || row.expires_at.getTime() <= at.getTime()) return { outcome: 'EXPIRED' };
      return { outcome: 'INVALID_STATE' };
    });
  }

  async expireIfDue(invitationId: InvitationId, at: Date): Promise<InvitationRecord> {
    return runInTransaction(async (conn) => {
      const before = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const beforeRow = before.rows[0];
      if (!beforeRow) throw new Error('invitation not found');
      if (TERMINAL_STATUSES.has(beforeRow.status) || beforeRow.expires_at.getTime() > at.getTime()) {
        return mapRow(beforeRow);
      }

      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations
         SET status = 'EXPIRED', expired_at = ?
         WHERE invitation_id = ? AND status NOT IN ('REDEEMED', 'EXPIRED', 'REVOKED') AND expires_at <= ?`,
        [at, invitationId, at],
      );
      if (updated.rowCount > 0) {
        await insertTransition(conn, invitationId, beforeRow.status, 'EXPIRED', at);
      }

      const reread = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      return mapRow(reread.rows[0]!);
    });
  }

  async revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord> {
    return runInTransaction(async (conn) => {
      const before = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      const beforeRow = before.rows[0];
      if (!beforeRow) throw new Error('invitation not found');
      // REVOKED is intentionally excluded from the WHERE clause's NOT IN
      // guard, not just REDEEMED: revoking an already-REVOKED invitation is
      // idempotent (the original revocation timestamp is preserved and no
      // duplicate transition row is written), matching the pre-existing
      // contract this method's callers already depend on.
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'REVOKED', revoked_at = ?
         WHERE invitation_id = ? AND status NOT IN ('REVOKED', 'REDEEMED')`,
        [revokedAt, invitationId],
      );
      if (updated.rowCount > 0) await insertTransition(conn, invitationId, beforeRow.status, 'REVOKED', revokedAt);
      const current = await execute<InvitationRow>(conn, `SELECT * FROM enrollment_invitations WHERE invitation_id = ?`, [
        invitationId,
      ]);
      if (!current.rows[0]) throw new Error('invitation not found');
      return mapRow(current.rows[0]);
    });
  }

  async revokeForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord | null> {
    return runInTransaction(async (conn) => {
      const before = await execute<InvitationRow>(
        conn,
        `SELECT * FROM enrollment_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      );
      const beforeRow = before.rows[0];
      if (!beforeRow) return null;
      const updated = await execute(
        conn,
        `UPDATE enrollment_invitations SET status = 'REVOKED', revoked_at = ?
         WHERE invitation_id = ? AND family_id = ? AND status NOT IN ('REVOKED', 'REDEEMED')`,
        [revokedAt, invitationId, familyId],
      );
      if (updated.rowCount > 0) await insertTransition(conn, invitationId, beforeRow.status, 'REVOKED', revokedAt);
      const current = await execute<InvitationRow>(
        conn,
        `SELECT * FROM enrollment_invitations WHERE invitation_id = ? AND family_id = ?`,
        [invitationId, familyId],
      );
      return current.rows[0] ? mapRow(current.rows[0]) : null;
    });
  }
}
