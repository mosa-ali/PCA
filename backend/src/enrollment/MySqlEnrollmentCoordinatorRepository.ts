import { execute, isDuplicateEntry, runInTransaction, SoftFailure } from '../db/pool.js';
import type { AttemptRecoveryResolution, AttemptRecoveryRow, EnrollDeviceOutcome, EnrollmentRepository, PrepareAttemptOutcome, VerifyRecoveryTokenHash } from './EnrollmentRepository.js';
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
  recovery_token_hash: string;
  platform: Platform;
  signing_public_key: string;
  encryption_public_key: string;
  device_id: string | null;
  signing_key_id: string | null;
  encryption_key_id: string | null;
  invitation_id: string;
  family_id: string;
  child_profile_id: string | null;
  age_ux_tier: 'YOUNG_CHILD' | 'TEEN';
  initial_policy_profile: 'BALANCED' | 'STRICT';
  status: 'PREPARED' | 'COMPLETED' | 'ABANDONED';
}

interface AttemptRecoveryDbRow {
  attempt_id: string;
  invitation_id: string;
  status: 'PREPARED' | 'COMPLETED' | 'ABANDONED';
  recovery_token_hash: string;
  device_id: string | null;
  signing_key_id: string | null;
  encryption_key_id: string | null;
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
  async prepareAttempt(
    tokenHash: string,
    platform: Platform,
    signingPublicKey: string,
    encryptionPublicKey: string,
    now: Date,
    attemptId: string,
    attemptRecoveryTokenHash: string,
  ): Promise<PrepareAttemptOutcome> {
    try {
      return await runInTransaction(async (conn) => {
        const invitationResult = await execute<InvitationRow>(
          conn,
          `SELECT invitation_id, family_id, platform, child_profile_id, age_ux_tier, initial_policy_profile, status, expires_at
           FROM enrollment_invitations WHERE token_hash = ? FOR UPDATE`,
          [tokenHash],
        );
        const invitation = invitationResult.rows[0];
        if (!invitation) throw new SoftFailure('NOT_FOUND');
        if (invitation.status === 'REVOKED') throw new SoftFailure('REVOKED');

        const tokenAttemptResult = await execute<AttemptRow>(
          conn,
          `SELECT a.attempt_id, a.token_hash, a.recovery_token_hash, a.platform,
                  a.signing_public_key, a.encryption_public_key, a.device_id,
                  a.signing_key_id, a.encryption_key_id, a.invitation_id, a.family_id,
                  a.status, i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
           FROM enrollment_bootstrap_attempts a
           INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
           WHERE a.token_hash = ? FOR UPDATE`,
          [tokenHash],
        );
        const tokenAttempt = tokenAttemptResult.rows[0];
        const idAttemptResult = await execute<{ attempt_id: string }>(
          conn,
          `SELECT attempt_id FROM enrollment_bootstrap_attempts WHERE attempt_id = ? FOR UPDATE`,
          [attemptId],
        );
        const tombstoneIdResult = await execute<{ attempt_id: string }>(
          conn,
          `SELECT attempt_id FROM enrollment_bootstrap_attempt_tombstones WHERE attempt_id = ? FOR UPDATE`,
          [attemptId],
        );
        const attemptIdAlreadyUsed = tombstoneIdResult.rows.length > 0 ||
          (idAttemptResult.rows.length > 0 && idAttemptResult.rows[0].attempt_id !== tokenAttempt?.attempt_id);
        const exactTuple = (attempt: AttemptRow) =>
          attempt.attempt_id === attemptId &&
          attempt.recovery_token_hash === attemptRecoveryTokenHash &&
          attempt.platform === platform &&
          attempt.signing_public_key === signingPublicKey &&
          attempt.encryption_public_key === encryptionPublicKey;

        if (invitation.status === 'REDEEMED') {
          if (tokenAttempt?.status === 'COMPLETED') {
            if (exactTuple(tokenAttempt)) return { outcome: 'COMPLETED' } as const;
            if (tokenAttempt.attempt_id === attemptId) throw new SoftFailure('ATTEMPT_CONFLICT');
          }
          throw new SoftFailure('ALREADY_REDEEMED');
        }
        if (now.getTime() >= invitation.expires_at.getTime()) throw new SoftFailure('EXPIRED');
        if (invitation.platform !== platform) throw new SoftFailure('PLATFORM_MISMATCH');
        if (attemptIdAlreadyUsed) throw new SoftFailure('ATTEMPT_CONFLICT');

        if (tokenAttempt) {
          if (tokenAttempt.status === 'PREPARED') {
            if (exactTuple(tokenAttempt)) return { outcome: 'READY' } as const;
            throw new SoftFailure('ATTEMPT_CONFLICT');
          }
          if (tokenAttempt.status === 'COMPLETED') {
            if (exactTuple(tokenAttempt)) return { outcome: 'COMPLETED' } as const;
            throw new SoftFailure('ALREADY_REDEEMED');
          }
          // ABANDONED is terminal for the old attempt id. A fresh id can
          // take over only while the caller still proves invitation
          // possession; the invitation row remains the serialization key.
          if (tokenAttempt.attempt_id === attemptId) throw new SoftFailure('ATTEMPT_CONFLICT');
          await execute(
            conn,
            `INSERT INTO enrollment_bootstrap_attempt_tombstones
               (attempt_id, invitation_id, recovery_token_hash, abandoned_at)
             VALUES (?, ?, ?, ?)`,
            [tokenAttempt.attempt_id, tokenAttempt.invitation_id, tokenAttempt.recovery_token_hash, now],
          );
          await execute(
            conn,
            `UPDATE enrollment_bootstrap_attempts
             SET attempt_id = ?, recovery_token_hash = ?, platform = ?, signing_public_key = ?,
                 encryption_public_key = ?, device_id = NULL, signing_key_id = NULL,
                 encryption_key_id = NULL, status = 'PREPARED', created_at = ?
             WHERE attempt_id = ? AND status = 'ABANDONED'`,
            [attemptId, attemptRecoveryTokenHash, platform, signingPublicKey, encryptionPublicKey, now, tokenAttempt.attempt_id],
          );
          return { outcome: 'READY' } as const;
        }

        await execute(
          conn,
          `INSERT INTO enrollment_bootstrap_attempts
             (attempt_id, token_hash, recovery_token_hash, platform, signing_public_key, encryption_public_key,
              device_id, signing_key_id, encryption_key_id, invitation_id, family_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 'PREPARED', ?)`,
          [attemptId, tokenHash, attemptRecoveryTokenHash, platform, signingPublicKey, encryptionPublicKey,
            invitation.invitation_id, invitation.family_id, now],
        );
        return { outcome: 'READY' } as const;
      });
    } catch (error) {
      if (error instanceof SoftFailure) return { outcome: error.outcome } as PrepareAttemptOutcome;
      if (isDuplicateEntry(error)) return { outcome: 'ATTEMPT_CONFLICT' };
      throw error;
    }
  }

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
   * attempt exists there with the SAME invitation/recovery-token hashes,
   * platform, and DSK/DEK, this is a retry of
   * the very same logical attempt: the original result is replayed
   * verbatim and NO new device is created. If attemptId collides with a
   * completed attempt bound to a different request tuple, that is a
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
            `SELECT a.attempt_id, a.token_hash, a.recovery_token_hash, a.platform,
                    a.signing_public_key, a.encryption_public_key,
                    a.device_id, a.signing_key_id, a.encryption_key_id, a.invitation_id, a.family_id,
                    a.status, i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
             FROM enrollment_bootstrap_attempts a
             INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
             WHERE a.attempt_id = ?`,
            [attemptId],
          );
          const attempt = attemptResult.rows[0];
          if (attempt?.status === 'COMPLETED' && attempt.device_id && attempt.signing_key_id && attempt.encryption_key_id) {
            const isExactReplay =
              attempt.token_hash === tokenHash &&
              attempt.recovery_token_hash === attemptRecoveryTokenHash &&
              attempt.platform === platform &&
              attempt.signing_public_key === signingPublicKey &&
              attempt.encryption_public_key === encryptionPublicKey;
            if (!isExactReplay) throw new SoftFailure<EnrollmentSoftCode>('ATTEMPT_CONFLICT');
            return {
              outcome: 'PAIRING_REQUEST_CREATED',
              replayed: true,
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

        const claimResult = await execute<AttemptRow>(
          conn,
          `SELECT a.attempt_id, a.token_hash, a.recovery_token_hash, a.platform,
                  a.signing_public_key, a.encryption_public_key, a.device_id,
                  a.signing_key_id, a.encryption_key_id, a.invitation_id, a.family_id,
                  a.status, i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
           FROM enrollment_bootstrap_attempts a
           INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
           WHERE a.token_hash = ? FOR UPDATE`,
          [tokenHash],
        );
        const claim = claimResult.rows[0];
        if (!claim || !(claim.status === 'PREPARED' && claim.attempt_id === attemptId &&
          claim.recovery_token_hash === attemptRecoveryTokenHash && claim.platform === platform &&
          claim.signing_public_key === signingPublicKey && claim.encryption_public_key === encryptionPublicKey)) {
          throw new SoftFailure<EnrollmentSoftCode>('ATTEMPT_CONFLICT');
        }

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

        const updated = await execute(
          conn,
          `UPDATE enrollment_bootstrap_attempts
           SET device_id = ?, signing_key_id = ?, encryption_key_id = ?, status = 'COMPLETED'
           WHERE attempt_id = ? AND status = 'PREPARED'`,
          [deviceId, signingKeyId, encryptionKeyId, attemptId],
        );
        if (updated.rowCount !== 1) throw new Error('Prepared enrollment claim lost its row lock before completion');

        return {
          outcome: 'PAIRING_REQUEST_CREATED',
          replayed: false,
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

  async resolveAttemptForRecovery(
    attemptId: string,
    verifyRecoveryTokenHash: VerifyRecoveryTokenHash,
    _now: Date,
  ): Promise<AttemptRecoveryResolution> {
    return runInTransaction(async (conn) => {
      const attemptLookup = await execute<{ invitation_id: string }>(
        conn,
        `SELECT invitation_id FROM enrollment_bootstrap_attempts WHERE attempt_id = ?`,
        [attemptId],
      );
      const tombstoneLookup = attemptLookup.rows[0]
        ? { rows: [] as Array<{ invitation_id: string }> }
        : await execute<{ invitation_id: string }>(
          conn,
          `SELECT invitation_id FROM enrollment_bootstrap_attempt_tombstones WHERE attempt_id = ?`,
          [attemptId],
        );
      const invitationId = attemptLookup.rows[0]?.invitation_id ?? tombstoneLookup.rows[0]?.invitation_id;
      if (!invitationId) return { outcome: 'NOT_FOUND' } as const;

      // Every resolver and bootstrap path locks the invitation before the
      // attempt row. This common order prevents a lost bootstrap response
      // from racing a stale reset decision.
      await execute<InvitationRow>(
        conn,
        `SELECT invitation_id, family_id, platform, child_profile_id, age_ux_tier, initial_policy_profile, status, expires_at
         FROM enrollment_invitations WHERE invitation_id = ? FOR UPDATE`,
        [invitationId],
      );
      const attemptResult = await execute<AttemptRecoveryDbRow>(
        conn,
        `SELECT a.attempt_id, a.invitation_id, a.status, a.recovery_token_hash, a.device_id,
                a.signing_key_id, a.encryption_key_id, i.child_profile_id, i.age_ux_tier, i.initial_policy_profile
         FROM enrollment_bootstrap_attempts a
         INNER JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
         WHERE a.attempt_id = ? FOR UPDATE`,
        [attemptId],
      );
      const row = attemptResult.rows[0];
      if (!row) {
        const tombstoneResult = await execute<{
          invitation_id: string;
          recovery_token_hash: string;
        }>(
          conn,
          `SELECT invitation_id, recovery_token_hash
           FROM enrollment_bootstrap_attempt_tombstones
           WHERE attempt_id = ? FOR UPDATE`,
          [attemptId],
        );
        const tombstone = tombstoneResult.rows[0];
        if (!tombstone || tombstone.invitation_id !== invitationId || !verifyRecoveryTokenHash(tombstone.recovery_token_hash)) {
          return { outcome: 'NOT_FOUND' } as const;
        }
        return { outcome: 'ABANDONED' } as const;
      }
      if (!verifyRecoveryTokenHash(row.recovery_token_hash)) return { outcome: 'NOT_FOUND' } as const;
      if (row.status === 'ABANDONED') return { outcome: 'ABANDONED' } as const;
      if (row.status === 'PREPARED') {
        await execute(
          conn,
          `UPDATE enrollment_bootstrap_attempts SET status = 'ABANDONED'
           WHERE attempt_id = ? AND status = 'PREPARED'`,
          [attemptId],
        );
        return { outcome: 'ABANDONED' } as const;
      }
      if (!row.device_id || !row.signing_key_id || !row.encryption_key_id) {
        throw new Error('Completed enrollment attempt has incomplete result fields');
      }
      const result: NonNullable<AttemptRecoveryRow['result']> = {
        deviceId: row.device_id,
        signingKeyId: row.signing_key_id,
        encryptionKeyId: row.encryption_key_id,
        childProfileId: row.child_profile_id,
        ageUxTier: row.age_ux_tier,
        initialPolicyProfile: row.initial_policy_profile,
      };
      return { outcome: 'COMPLETED', result } as const;
    });
  }
}
