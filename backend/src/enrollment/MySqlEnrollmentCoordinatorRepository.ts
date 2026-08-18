import { execute, getPool, isDuplicateEntry, runInTransaction, SoftFailure } from '../db/pool.js';
import type { AttemptRecoveryRow, EnrollDeviceOutcome, EnrollmentRepository } from './EnrollmentRepository.js';
import type { Platform } from './types.js';

interface InvitationRow {
  invitation_id: string;
  family_id: string;
  platform: Platform;
  child_profile_id: string | null;
  age_ux_tier: 'YOUNG_CHILD' | 'TEEN';
  initial_policy_profile: 'BALANCED' | 'STRICT';
  status: 'CREATED' | 'OPENED' | 'INSTALL_REQUIRED' | 'APP_INSTALLED' | 'AUTHORIZATION_REQUIRED' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';
  expires_at: Date;
}

interface AttemptRow {
  attempt_id: string;
  token_hash: string;
  signing_public_key: string;
  encryption_public_key: string;
  device_id: string;
  signing_key_id: string;
  encryption_key_id: string;
  invitation_id: string;
  family_id: string;
  child_profile_id: string | null;
  age_ux_tier: 'YOUNG_CHILD' | 'TEEN';
  initial_policy_profile: 'BALANCED' | 'STRICT';
}

interface AttemptRecoveryDbRow {
  device_id: string;
  recovery_token_hash: string;
  child_profile_id: string | null;
  age_ux_tier: 'YOUNG_CHILD' | 'TEEN';
  initial_policy_profile: 'BALANCED' | 'STRICT';
}

type EnrollmentSoftCode =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_REDEEMED'
  | 'PLATFORM_MISMATCH'
  | 'DUPLICATE_KEY'
  | 'ATTEMPT_CONFLICT';

export class MySqlEnrollmentCoordinatorRepository implements EnrollmentRepository {
  /**
   * ONE transaction spans the invitation, device, and bootstrap-attempt
   * tables. The invitation row is locked with SELECT ... FOR UPDATE (the
   * row already exists by construction -- invitations are always created
   * ahead of enrollment). Concurrent enrollment attempts against the same
   * invitation serialize on this InnoDB row lock: the first to acquire it
   * redeems the invitation, creates the device, and records the
   * (attemptId -> device) mapping; every other concurrent caller blocks,
   * then (once unblocked) observes the now-REDEEMED row.
   *
   * PCA-ENROLLMENT-RUNTIME-2 idempotency/recovery: once REDEEMED is
   * observed, this method no longer assumes the caller is a stranger --
   * it looks up enrollment_bootstrap_attempts by attemptId. If a completed
   * attempt exists there with the SAME token/DSK/DEK, this is a retry of
   * the very same logical attempt: the original result is replayed
   * verbatim and NO new device is created. If attemptId collides with a
   * completed attempt bound to different token/DSK/DEK, that is a
   * conflicting reuse of the attempt id (ATTEMPT_CONFLICT, collapsed to the
   * same generic response as every other non-authorized outcome at the
   * HTTP layer -- never distinguishable, never an oracle). Only if no
   * attempt row exists at all is this genuinely ALREADY_REDEEMED (someone
   * else's redemption, or a different attemptId presented against an
   * already-redeemed invitation, per spec Section 6).
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
    attemptId: string,
    attemptRecoveryTokenHash: string,
  ): Promise<EnrollDeviceOutcome> {
    try {
      return await runInTransaction(async (conn) => {
        const invitationResult = await execute<InvitationRow>(
          conn,
          `SELECT invitation_id, family_id, platform, child_profile_id, age_ux_tier, initial_policy_profile, status, expires_at
           FROM enrollment_invitations
           WHERE token_hash = ?
           FOR UPDATE`,
          [tokenHash],
        );
        const invitation = invitationResult.rows[0];
        if (!invitation) throw new SoftFailure<EnrollmentSoftCode>('NOT_FOUND');
        if (invitation.status === 'REVOKED') throw new SoftFailure<EnrollmentSoftCode>('REVOKED');

        if (invitation.status === 'REDEEMED') {
          const attemptResult = await execute<AttemptRow>(
            conn,
            `SELECT a.attempt_id, a.token_hash, a.signing_public_key, a.encryption_public_key,
                    a.device_id, a.signing_key_id, a.encryption_key_id, a.invitation_id, a.family_id,
                    i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
             FROM enrollment_bootstrap_attempts a
             INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
             WHERE a.attempt_id = ?`,
            [attemptId],
          );
          const attempt = attemptResult.rows[0];
          if (attempt) {
            const isExactReplay =
              attempt.token_hash === tokenHash &&
              attempt.signing_public_key === signingPublicKey &&
              attempt.encryption_public_key === encryptionPublicKey;
            if (!isExactReplay) throw new SoftFailure<EnrollmentSoftCode>('ATTEMPT_CONFLICT');
            return {
              outcome: 'PAIRING_REQUEST_CREATED',
              deviceId: attempt.device_id,
              signingKeyId: attempt.signing_key_id,
              encryptionKeyId: attempt.encryption_key_id,
              familyId: attempt.family_id,
              invitationId: attempt.invitation_id,
              childProfileId: attempt.child_profile_id,
              ageUxTier: attempt.age_ux_tier,
              initialPolicyProfile: attempt.initial_policy_profile,
            } as const;
          }
          throw new SoftFailure<EnrollmentSoftCode>('ALREADY_REDEEMED');
        }

        if (now.getTime() >= invitation.expires_at.getTime()) throw new SoftFailure<EnrollmentSoftCode>('EXPIRED');
        if (invitation.platform !== platform) throw new SoftFailure<EnrollmentSoftCode>('PLATFORM_MISMATCH');

        await execute(
          conn,
          `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at, paired_at, paired_by_account_id)
           VALUES (?, ?, ?, 'PAIRING_PENDING', ?, NULL, NULL, NULL)`,
          [deviceId, invitation.family_id, platform, now],
        );
        try {
          await execute(
            conn,
            `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
             VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL), (?, ?, 'DEK', ?, 'ACTIVE', ?, NULL)`,
            [deviceId, signingKeyId, signingPublicKey, now, deviceId, encryptionKeyId, encryptionPublicKey, now],
          );
        } catch (error) {
          if (isDuplicateEntry(error)) throw new SoftFailure<EnrollmentSoftCode>('DUPLICATE_KEY');
          throw error;
        }

        await execute(
          conn,
          `UPDATE enrollment_invitations SET status = 'REDEEMED', redeemed_at = ?
           WHERE invitation_id = ? AND status NOT IN ('REVOKED', 'REDEEMED')`,
          [now, invitation.invitation_id],
        );

        try {
          await execute(
            conn,
            `INSERT INTO enrollment_bootstrap_attempts
               (attempt_id, token_hash, recovery_token_hash, platform, signing_public_key, encryption_public_key,
                device_id, signing_key_id, encryption_key_id, invitation_id, family_id, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`,
            [
              attemptId,
              tokenHash,
              attemptRecoveryTokenHash,
              platform,
              signingPublicKey,
              encryptionPublicKey,
              deviceId,
              signingKeyId,
              encryptionKeyId,
              invitation.invitation_id,
              invitation.family_id,
              now,
            ],
          );
        } catch (error) {
          // A concurrent competing request won the race for this exact
          // attempt_id (different token/DSK/DEK) between our earlier
          // "REDEEMED?" check and this insert, or the recovery-token hash
          // collided (astronomically unlikely for a 256-bit secret). Either
          // way this whole transaction rolls back -- including the
          // invitation redemption and device/key inserts above -- so no
          // orphan device or wasted invitation survives.
          if (isDuplicateEntry(error)) throw new SoftFailure<EnrollmentSoftCode>('ATTEMPT_CONFLICT');
          throw error;
        }

        return {
          outcome: 'PAIRING_REQUEST_CREATED',
          deviceId,
          signingKeyId,
          encryptionKeyId,
          familyId: invitation.family_id,
          invitationId: invitation.invitation_id,
          childProfileId: invitation.child_profile_id,
          ageUxTier: invitation.age_ux_tier,
          initialPolicyProfile: invitation.initial_policy_profile,
        } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: error.outcome } as EnrollDeviceOutcome;
      throw error;
    }
  }

  /**
   * Read-only lookup by the non-secret attemptId. No transaction/locking is
   * needed: enrollment_bootstrap_attempts rows are write-once (inserted
   * exactly once, in enrollDevice's transaction above, and never updated).
   * The security boundary is enforced by the CALLER (EnrollmentCoordinator)
   * comparing the caller-supplied attemptRecoveryToken against
   * recoveryTokenHash -- this method alone must never be treated as an
   * authorization check.
   */
  async findAttemptForRecovery(attemptId: string): Promise<AttemptRecoveryRow | null> {
    const [rows] = await getPool().query(
      `SELECT a.device_id, a.recovery_token_hash, i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
       FROM enrollment_bootstrap_attempts a
       INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
       WHERE a.attempt_id = ?`,
      [attemptId],
    );
    const row = (rows as AttemptRecoveryDbRow[])[0];
    if (!row) return null;
    return {
      deviceId: row.device_id,
      recoveryTokenHash: row.recovery_token_hash,
      childProfileId: row.child_profile_id,
      ageUxTier: row.age_ux_tier,
      initialPolicyProfile: row.initial_policy_profile,
    };
  }
}
