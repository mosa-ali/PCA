import { isUniqueViolation, runInTransaction, SoftFailure } from '../db/pool.js';
import type { EnrollDeviceOutcome, EnrollmentRepository } from './EnrollmentRepository.js';
import type { Platform } from './types.js';

interface InvitationRow {
  invitation_id: string;
  family_id: string;
  platform: Platform;
  status: 'CREATED' | 'OPENED' | 'REDEEMED' | 'REVOKED';
  expires_at: Date;
}

type EnrollmentSoftCode = 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'ALREADY_REDEEMED' | 'PLATFORM_MISMATCH' | 'DUPLICATE_KEY';

export class PostgresEnrollmentCoordinatorRepository implements EnrollmentRepository {
  /**
   * ONE transaction spans both the invitation and device tables. The
   * invitation row is locked with SELECT ... FOR UPDATE (the row already
   * exists by construction -- invitations are always created ahead of
   * enrollment -- so, unlike the release-current-pointer bug fixed in
   * PG-CORR-2, there is no "locking a row that doesn't exist yet" gap
   * here). Concurrent enrollment attempts against the same invitation
   * serialize on this lock: the first to acquire it redeems the invitation
   * and creates the device, PAIRING_PENDING; every other concurrent caller
   * blocks, then (once unblocked) observes the now-REDEEMED row and
   * cleanly reports ALREADY_REDEEMED without creating any device/key row.
   *
   * The device is inserted PAIRING_PENDING, never ACTIVE or PAIRED --
   * claiming an invitation and submitting DSK/DEK material is not, by
   * itself, trust (doc 08 Section 3).
   */
  async enrollDevice(
    tokenHash: string,
    platform: Platform,
    signingPublicKey: string,
    encryptionPublicKey: string,
    deviceId: string,
    signingKeyId: string,
    encryptionKeyId: string,
    now: Date,
  ): Promise<EnrollDeviceOutcome> {
    try {
      return await runInTransaction(async (client) => {
        const invitationResult = await client.query<InvitationRow>(
          `SELECT invitation_id, family_id, platform, status, expires_at
           FROM enrollment_invitations
           WHERE token_hash = $1
           FOR UPDATE`,
          [tokenHash],
        );
        const invitation = invitationResult.rows[0];
        if (!invitation) throw new SoftFailure<EnrollmentSoftCode>('NOT_FOUND');
        if (invitation.status === 'REVOKED') throw new SoftFailure<EnrollmentSoftCode>('REVOKED');
        if (invitation.status === 'REDEEMED') throw new SoftFailure<EnrollmentSoftCode>('ALREADY_REDEEMED');
        if (now.getTime() >= invitation.expires_at.getTime()) throw new SoftFailure<EnrollmentSoftCode>('EXPIRED');
        if (invitation.platform !== platform) throw new SoftFailure<EnrollmentSoftCode>('PLATFORM_MISMATCH');

        await client.query(
          `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at, paired_at, paired_by_account_id)
           VALUES ($1, $2, $3, 'PAIRING_PENDING', $4, NULL, NULL, NULL)`,
          [deviceId, invitation.family_id, platform, now],
        );
        try {
          await client.query(
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES ($1, $2, 'DSK', $3, 'ACTIVE', $4, NULL), ($1, $5, 'DEK', $6, 'ACTIVE', $4, NULL)`,
            [deviceId, signingKeyId, signingPublicKey, now, encryptionKeyId, encryptionPublicKey],
          );
        } catch (error) {
          if (isUniqueViolation(error)) throw new SoftFailure<EnrollmentSoftCode>('DUPLICATE_KEY');
          throw error;
        }

        await client.query(
          `UPDATE enrollment_invitations SET status = 'REDEEMED', redeemed_at = $2
           WHERE invitation_id = $1 AND status NOT IN ('REVOKED', 'REDEEMED')`,
          [invitation.invitation_id, now],
        );

        return {
          outcome: 'PAIRING_REQUEST_CREATED',
          deviceId,
          signingKeyId,
          encryptionKeyId,
          familyId: invitation.family_id,
          invitationId: invitation.invitation_id,
        } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: error.outcome } as EnrollDeviceOutcome;
      throw error;
    }
  }
}
