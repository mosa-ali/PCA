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
  | { outcome: 'DUPLICATE_KEY' };

/**
 * The enrollment coordinator's persistence port. enrollDevice must couple
 * invitation validation/redemption with device+DSK+DEK creation as ONE
 * atomic operation: no outcome may leave a consumed invitation with no
 * created device/keys, or a created device with an invitation still usable
 * by someone else. The created device is always PAIRING_PENDING, never
 * ACTIVE or PAIRED -- this operation alone never establishes trust
 * (doc 08 Section 3).
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
  ): Promise<EnrollDeviceOutcome>;
}
