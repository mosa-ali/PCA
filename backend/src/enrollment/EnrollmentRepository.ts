import type { Platform } from './types.js';

export type EnrollDeviceOutcome =
  | {
      outcome: 'PAIRING_REQUEST_CREATED';
      deviceId: string;
      signingKeyId: string;
      encryptionKeyId: string;
      familyId: string;
      invitationId: string;
    }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'PLATFORM_MISMATCH' }
  | { outcome: 'DUPLICATE_KEY' }
  /**
   * The same attempt_id was already used (by this or a concurrent request)
   * for a DIFFERENT token/DSK/DEK, or a genuinely concurrent competing
   * insert lost the race for this attempt_id. Deliberately collapsed to the
   * same generic response as NOT_FOUND/EXPIRED/etc at the HTTP layer -- see
   * bootstrapRoutes.ts -- so it never becomes an oracle either.
   */
  | { outcome: 'ATTEMPT_CONFLICT' };

/** Row shape returned for the attempt-recovery lookup -- see EnrollmentRepository.findAttemptForRecovery. */
export interface AttemptRecoveryRow {
  deviceId: string;
  recoveryTokenHash: string;
}

/**
 * The enrollment coordinator's persistence port. enrollDevice must couple
 * invitation validation/redemption with device+DSK+DEK creation as ONE
 * atomic operation: no outcome may leave a consumed invitation with no
 * created device/keys, or a created device with an invitation still usable
 * by someone else. The created device is always PAIRING_PENDING, never
 * ACTIVE or PAIRED -- this operation alone never establishes trust
 * (doc 08 Section 3).
 *
 * PCA-ENROLLMENT-RUNTIME-2: enrollDevice is also IDEMPOTENT per
 * (attemptId, tokenHash, signingPublicKey, encryptionPublicKey) -- a retry
 * presenting the exact same tuple as an already-committed attempt returns
 * the SAME outcome (same deviceId/keys) rather than ALREADY_REDEEMED, and
 * never creates a second device. See MySqlEnrollmentCoordinatorRepository
 * and migrations/0003_enrollment_bootstrap_attempts.sql for the persisted
 * attempt/result mapping this depends on.
 *
 * Only a deterministic in-memory implementation exists for tests;
 * MySqlEnrollmentCoordinatorRepository is the production implementation and
 * is the only place that spans the invitation and device tables in a single
 * transaction -- reusing the separately-transacted InvitationRepository
 * and DeviceRepository here would NOT be atomic across both.
 */
export interface EnrollmentRepository {
  enrollDevice(
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
  ): Promise<EnrollDeviceOutcome>;

  /**
   * Look up a completed attempt by its (non-secret) attemptId alone, for
   * the recovery endpoint to then verify against the caller-supplied
   * attemptRecoveryToken. Returns null if no completed attempt exists for
   * this id -- the caller (EnrollmentCoordinator.recoverAttempt) must treat
   * "not found" and "found but recovery token mismatch" identically, so
   * this method itself is not the security boundary -- the hash comparison
   * is.
   */
  findAttemptForRecovery(attemptId: string): Promise<AttemptRecoveryRow | null>;
}
