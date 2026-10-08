import type { Platform } from './types.js';
import type { AgeUxTier, InitialPolicyProfile } from '../invitation/types.js';

export type EnrollDeviceOutcome =
  | {
      outcome: 'PAIRING_REQUEST_CREATED';
      /** True when this exact attempt was already committed and its result was replayed. */
      replayed: boolean;
      deviceId: string;
      signingKeyId: string;
      encryptionKeyId: string;
      familyId: string;
      invitationId: string;
      childProfileId: string | null;
      ageUxTier: AgeUxTier;
      initialPolicyProfile: InitialPolicyProfile;
    }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'PLATFORM_MISMATCH' }
  | { outcome: 'DUPLICATE_KEY' }
  /**
   * The same attempt_id was already used (by this or a concurrent request)
   * for a DIFFERENT invitation/recovery hash, platform, or DSK/DEK, or a
   * genuinely concurrent competing insert lost the race for this attempt_id.
   * Deliberately collapsed to the
   * same generic response as NOT_FOUND/EXPIRED/etc at the HTTP layer -- see
   * bootstrapRoutes.ts -- so it never becomes an oracle either.
   */
  | { outcome: 'ATTEMPT_CONFLICT' };

export type PrepareAttemptOutcome =
  | { outcome: 'READY' }
  | { outcome: 'COMPLETED' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'PLATFORM_MISMATCH' }
  | { outcome: 'ATTEMPT_CONFLICT' };

export type AttemptStatus = 'PREPARED' | 'COMPLETED' | 'ABANDONED';

/** Narrow persisted state evaluated by EnrollmentRepository's serialized recovery operation. */
export interface AttemptRecoveryRow {
  status: AttemptStatus;
  recoveryTokenHash: string;
  result: {
    deviceId: string;
    signingKeyId: string;
    encryptionKeyId: string;
    childProfileId: string | null;
    ageUxTier: AgeUxTier;
    initialPolicyProfile: InitialPolicyProfile;
  } | null;
}

export type AttemptRecoveryResolution =
  | { outcome: 'COMPLETED'; result: NonNullable<AttemptRecoveryRow['result']> }
  | { outcome: 'ABANDONED' }
  | { outcome: 'NOT_FOUND' };

/**
 * A resolver callback keeps the recovery-secret comparison in the same
 * transaction/row lock as PREPARED -> ABANDONED, while preserving the
 * coordinator's constant-time hash comparison boundary.
 */
export type VerifyRecoveryTokenHash = (storedHash: string) => boolean;

/**
 * The enrollment coordinator's persistence port. enrollDevice must require
 * an exact committed PREPARED reservation and couple invitation validation/
 * redemption with device+DSK+DEK creation as ONE
 * atomic operation: no outcome may leave a consumed invitation with no
 * created device/keys, or a created device with an invitation still usable
 * by someone else. The created device is always PAIRING_PENDING, never
 * ACTIVE or PAIRED -- this operation alone never establishes trust
 * (doc 08 Section 3).
 *
 * PCA-ENROLLMENT-RUNTIME-2: enrollDevice is also IDEMPOTENT per
 * (attemptId, invitationHash, recoveryTokenHash, platform, signingPublicKey,
 * encryptionPublicKey) -- a retry presenting the exact same tuple as an
 * already-committed attempt returns the same deviceId/keys with
 * `replayed: true` rather than ALREADY_REDEEMED,
 * and never creates a second device. The first commit returns
 * `replayed: false`, allowing one-time side effects to avoid duplication on
 * retries. See MySqlEnrollmentCoordinatorRepository
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
  /** Persist a one-use reservation before the client sends bootstrap; bootstrap rejects if the exact claim is absent. */
  prepareAttempt(
    tokenHash: string,
    platform: Platform,
    signingPublicKey: string,
    encryptionPublicKey: string,
    now: Date,
    attemptId: string,
    attemptRecoveryTokenHash: string,
  ): Promise<PrepareAttemptOutcome>;

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
   * Atomically resolve an attempt under the invitation-row lock. A valid
   * recovery secret returns a completed result or commits PREPARED ->
   * ABANDONED; bootstrap and resolution therefore cannot both win.
   */
  resolveAttemptForRecovery(
    attemptId: string,
    verifyRecoveryTokenHash: VerifyRecoveryTokenHash,
    now: Date,
  ): Promise<AttemptRecoveryResolution>;
}
