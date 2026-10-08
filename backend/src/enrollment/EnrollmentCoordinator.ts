import { randomUUID, timingSafeEqual } from 'node:crypto';
import { hashInvitationToken, isPlausibleInvitationToken } from '../invitation/token.js';
import { isPlausiblePublicKey } from '../device/publicKey.js';
import { hashAttemptRecoveryToken, isPlausibleAttemptId, isPlausibleAttemptRecoveryToken } from './attempt.js';
import type { EnrollDeviceOutcome, EnrollmentRepository, PrepareAttemptOutcome } from './EnrollmentRepository.js';
import type { EnrollDeviceInput, EnrollDeviceResult, Platform, RecoverAttemptInput, RecoverAttemptOutcome } from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';
import type { SlotReservationService } from '../entitlements/slots/SlotReservationService.js';

export type EnrollmentErrorCode =
  | 'INVALID_TOKEN'
  | 'INVALID_PUBLIC_KEY'
  | 'KEYS_NOT_DISTINCT'
  | 'INVALID_PLATFORM'
  | 'INVALID_ATTEMPT_ID'
  | 'INVALID_RECOVERY_TOKEN'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_REDEEMED'
  | 'PLATFORM_MISMATCH'
  | 'DUPLICATE_KEY'
  | 'ATTEMPT_CONFLICT';

/** Fixed, generic messages per code -- never interpolates the raw token, public key, or family data. */
export class EnrollmentError extends Error {
  readonly code: EnrollmentErrorCode;
  constructor(code: EnrollmentErrorCode) {
    super(ENROLLMENT_ERROR_MESSAGES[code]);
    this.name = 'EnrollmentError';
    this.code = code;
  }
}

const ENROLLMENT_ERROR_MESSAGES: Record<EnrollmentErrorCode, string> = {
  INVALID_TOKEN: 'Invitation token is malformed.',
  INVALID_PUBLIC_KEY: 'Device public key is malformed.',
  KEYS_NOT_DISTINCT: 'Signing and encryption public keys must be distinct.',
  INVALID_PLATFORM: 'Platform is not supported.',
  INVALID_ATTEMPT_ID: 'Bootstrap attempt id is malformed.',
  INVALID_RECOVERY_TOKEN: 'Attempt recovery token is malformed.',
  NOT_FOUND: 'Invitation was not found.',
  EXPIRED: 'Invitation has expired.',
  REVOKED: 'Invitation was revoked.',
  ALREADY_REDEEMED: 'Invitation was already redeemed.',
  PLATFORM_MISMATCH: 'Device platform does not match the invitation.',
  DUPLICATE_KEY: 'This public key is already registered to a device.',
  ATTEMPT_CONFLICT: 'This bootstrap attempt id cannot be used for this request.',
};

const VALID_PLATFORMS: ReadonlySet<string> = new Set(['ANDROID', 'IOS']);

/**
 * The ONLY supported way to consume an enrollment invitation. The client
 * must first commit the exact attempt tuple through prepareAttempt; a
 * direct bootstrap without that reservation is rejected. There is
 * deliberately no standalone "redeem invitation" operation reachable from
 * enrollment -- redemption only ever happens bundled with device+DSK+DEK
 * creation in one atomic transaction, so a failure partway through can
 * never consume the invitation while leaving no device identity (or vice
 * versa).
 *
 * The resulting device is PAIRING_PENDING -- claiming an invitation and
 * submitting keys is not, by itself, trust: an authorized parent must
 * still confirm the key fingerprints (PairingService.confirmPairing,
 * doc 08 PCA-FR-141) before the device is PAIRED, and first-policy
 * delivery via the Family Trust Set before it is ACTIVE.
 *
 * PCA-ENROLLMENT-RUNTIME-2: bootstrap authority remains ONLY "possession of
 * the valid one-time invitation token" -- attemptId and
 * attemptRecoveryToken are never authority to redeem anything. attemptId
 * only lets a RETRY of the same logical attempt (same invitation hash,
 * recovery-token hash, platform and DSK/DEK) be recognized as such instead
 * of colliding with ALREADY_REDEEMED. attemptRecoveryToken only lets a caller who already
 * generated it (before the original request) recover the outcome of an
 * attempt whose response was lost, via recoverAttempt below, WITHOUT ever
 * re-presenting the raw invitation token.
 */
export class EnrollmentCoordinator {
  private readonly repository: EnrollmentRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;
  private readonly slotReservationService: SlotReservationService | null;

  constructor(
    repository: EnrollmentRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    slotReservationService: SlotReservationService | null = null,
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
    this.slotReservationService = slotReservationService;
  }

  async enrollDevice(input: EnrollDeviceInput): Promise<EnrollDeviceResult> {
    const { tokenHash, attemptRecoveryTokenHash } = validateAttemptInput(input);
    const deviceId = randomUUID();
    const signingKeyId = randomUUID();
    const encryptionKeyId = randomUUID();

    const result: EnrollDeviceOutcome = await this.repository.enrollDevice(
      tokenHash,
      input.platform,
      input.signingPublicKey,
      input.encryptionPublicKey,
      deviceId,
      signingKeyId,
      encryptionKeyId,
      this.now(),
      input.attemptId,
      attemptRecoveryTokenHash,
    );

    switch (result.outcome) {
      case 'PAIRING_REQUEST_CREATED':
        if (this.slotReservationService) await this.slotReservationService.consumeForInvitation(result.invitationId);
        if (!result.replayed) {
          await this.auditService.record({
            familyId: result.familyId,
            actionType: 'ROLE_ACCEPT',
            actorDeviceId: result.deviceId,
            actorMemberId: null,
            targetScope: { kind: 'DEVICE', id: result.deviceId },
            authorizationRole: null,
            trustSetEpoch: 0,
            policyRevision: null,
            clientMonotonicSequence: null,
            resultStatus: 'SUCCESS',
            targetAcknowledgementCount: 0,
            reasonCategory: null,
            correlationId: result.invitationId,
            actionId: null,
          });
        }
        return {
          deviceId: result.deviceId,
          signingKeyId: result.signingKeyId,
          encryptionKeyId: result.encryptionKeyId,
          familyId: result.familyId,
          invitationId: result.invitationId,
          childProfileId: result.childProfileId,
          ageUxTier: result.ageUxTier,
          initialPolicyProfile: result.initialPolicyProfile,
          status: 'PAIRING_PENDING',
        };
      case 'NOT_FOUND':
        throw new EnrollmentError('NOT_FOUND');
      case 'EXPIRED':
        throw new EnrollmentError('EXPIRED');
      case 'REVOKED':
        throw new EnrollmentError('REVOKED');
      case 'ALREADY_REDEEMED':
        throw new EnrollmentError('ALREADY_REDEEMED');
      case 'PLATFORM_MISMATCH':
        throw new EnrollmentError('PLATFORM_MISMATCH');
      case 'DUPLICATE_KEY':
        throw new EnrollmentError('DUPLICATE_KEY');
      case 'ATTEMPT_CONFLICT':
        throw new EnrollmentError('ATTEMPT_CONFLICT');
    }
  }

  /**
   * Reserve the exact request tuple before the client sends /bootstrap.
   * Raw invitation and recovery tokens are hashed before persistence; the
   * reservation stores public keys only and creates no device or key rows.
   */
  async prepareAttempt(input: EnrollDeviceInput): Promise<'READY' | 'COMPLETED'> {
    const { tokenHash, attemptRecoveryTokenHash } = validateAttemptInput(input);
    const result = await this.repository.prepareAttempt(
      tokenHash,
      input.platform,
      input.signingPublicKey,
      input.encryptionPublicKey,
      this.now(),
      input.attemptId,
      attemptRecoveryTokenHash,
    );
    if (result.outcome === 'READY' || result.outcome === 'COMPLETED') return result.outcome;
    throw enrollmentErrorForOutcome(result);
  }

  /**
   * Recovers the outcome of a PREVIOUSLY-COMPLETED bootstrap attempt whose
   * HTTP response was lost, using only the client-generated attemptId +
   * attemptRecoveryToken -- never the raw invitation token, which the
   * caller may not even still hold in memory after a process restart.
   *
   * NO EXISTENCE ORACLE: an unknown attemptId and a known attemptId with a
   * wrong attemptRecoveryToken throw the exact same EnrollmentError
   * ('NOT_FOUND') -- a caller can never learn "an attempt with this id
   * exists" without already possessing its recovery secret. attemptId
   * alone is public/guessable and must never disclose anything by itself.
   */
  async recoverAttempt(input: RecoverAttemptInput): Promise<RecoverAttemptOutcome> {
    if (!isPlausibleAttemptId(input.attemptId)) throw new EnrollmentError('INVALID_ATTEMPT_ID');
    if (!isPlausibleAttemptRecoveryToken(input.attemptRecoveryToken)) throw new EnrollmentError('INVALID_RECOVERY_TOKEN');

    const candidateHash = Buffer.from(hashAttemptRecoveryToken(input.attemptRecoveryToken), 'hex');
    const resolution = await this.repository.resolveAttemptForRecovery(
      input.attemptId,
      (recoveryTokenHash) => {
        const storedHash = Buffer.from(recoveryTokenHash, 'hex');
        return candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);
      },
      this.now(),
    );
    if (resolution.outcome === 'NOT_FOUND') throw new EnrollmentError('NOT_FOUND');
    if (resolution.outcome === 'ABANDONED') return { outcome: 'ABANDONED' };
    return {
      outcome: 'COMPLETED',
      result: { ...resolution.result, status: 'PAIRING_PENDING' },
    };
  }
}

function validateAttemptInput(input: EnrollDeviceInput): { tokenHash: string; attemptRecoveryTokenHash: string } {
  if (!isPlausibleInvitationToken(input.rawInvitationToken)) throw new EnrollmentError('INVALID_TOKEN');
  if (!isValidPlatform(input.platform)) throw new EnrollmentError('INVALID_PLATFORM');
  if (!isPlausiblePublicKey(input.signingPublicKey) || !isPlausiblePublicKey(input.encryptionPublicKey)) {
    throw new EnrollmentError('INVALID_PUBLIC_KEY');
  }
  if (input.signingPublicKey === input.encryptionPublicKey) throw new EnrollmentError('KEYS_NOT_DISTINCT');
  if (!isPlausibleAttemptId(input.attemptId)) throw new EnrollmentError('INVALID_ATTEMPT_ID');
  if (!isPlausibleAttemptRecoveryToken(input.attemptRecoveryToken)) throw new EnrollmentError('INVALID_RECOVERY_TOKEN');
  return {
    tokenHash: hashInvitationToken(input.rawInvitationToken),
    attemptRecoveryTokenHash: hashAttemptRecoveryToken(input.attemptRecoveryToken),
  };
}

function enrollmentErrorForOutcome(result: Exclude<PrepareAttemptOutcome, { outcome: 'READY' | 'COMPLETED' }>): EnrollmentError {
  return new EnrollmentError(result.outcome);
}

function isValidPlatform(candidate: string): candidate is Platform {
  return VALID_PLATFORMS.has(candidate);
}
