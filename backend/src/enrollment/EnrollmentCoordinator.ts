import { randomUUID } from 'node:crypto';
import { hashInvitationToken, isPlausibleInvitationToken } from '../invitation/token.js';
import { isPlausiblePublicKey } from '../device/publicKey.js';
import type { EnrollDeviceOutcome, EnrollmentRepository } from './EnrollmentRepository.js';
import type { EnrollDeviceInput, EnrollDeviceResult, Platform } from './types.js';

export type EnrollmentErrorCode =
  | 'INVALID_TOKEN'
  | 'INVALID_PUBLIC_KEY'
  | 'KEYS_NOT_DISTINCT'
  | 'INVALID_PLATFORM'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_REDEEMED'
  | 'PLATFORM_MISMATCH'
  | 'DUPLICATE_KEY';

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
  NOT_FOUND: 'Invitation was not found.',
  EXPIRED: 'Invitation has expired.',
  REVOKED: 'Invitation was revoked.',
  ALREADY_REDEEMED: 'Invitation was already redeemed.',
  PLATFORM_MISMATCH: 'Device platform does not match the invitation.',
  DUPLICATE_KEY: 'This public key is already registered to a device.',
};

const VALID_PLATFORMS: ReadonlySet<string> = new Set(['ANDROID', 'IOS']);

/**
 * The ONLY supported way to consume an enrollment invitation. There is
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
 */
export class EnrollmentCoordinator {
  private readonly repository: EnrollmentRepository;
  private readonly now: () => Date;

  constructor(repository: EnrollmentRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async enrollDevice(input: EnrollDeviceInput): Promise<EnrollDeviceResult> {
    if (!isPlausibleInvitationToken(input.rawInvitationToken)) throw new EnrollmentError('INVALID_TOKEN');
    if (!isValidPlatform(input.platform)) throw new EnrollmentError('INVALID_PLATFORM');
    if (!isPlausiblePublicKey(input.signingPublicKey) || !isPlausiblePublicKey(input.encryptionPublicKey)) {
      throw new EnrollmentError('INVALID_PUBLIC_KEY');
    }
    // DSK and DEK are distinct roles (doc 09 Section 3.1) -- reusing the
    // same bytes for both would collapse the role separation the
    // architecture requires, independent of the permanent per-value
    // uniqueness the persistence layer also enforces.
    if (input.signingPublicKey === input.encryptionPublicKey) throw new EnrollmentError('KEYS_NOT_DISTINCT');

    const tokenHash = hashInvitationToken(input.rawInvitationToken);
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
    );

    switch (result.outcome) {
      case 'PAIRING_REQUEST_CREATED':
        return {
          deviceId: result.deviceId,
          signingKeyId: result.signingKeyId,
          encryptionKeyId: result.encryptionKeyId,
          familyId: result.familyId,
          invitationId: result.invitationId,
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
    }
  }
}

function isValidPlatform(candidate: string): candidate is Platform {
  return VALID_PLATFORMS.has(candidate);
}
