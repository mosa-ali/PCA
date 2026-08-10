import type { Platform } from './types.js';

export type EnrollDeviceOutcome =
  | { outcome: 'ENROLLED'; deviceId: string; keyId: string; familyId: string; invitationId: string }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'PLATFORM_MISMATCH' }
  | { outcome: 'DUPLICATE_KEY' };

/**
 * The enrollment coordinator's persistence port. enrollDevice must couple
 * invitation validation/redemption with device+initial-key creation as ONE
 * atomic operation: no outcome may leave a consumed invitation with no
 * enrolled device, or an enrolled device with an invitation still usable
 * by someone else.
 *
 * Only a deterministic in-memory implementation exists for tests;
 * PostgresEnrollmentCoordinator is the production implementation and is
 * the only place that spans the invitation and device tables in a single
 * transaction -- reusing the separately-transacted InvitationRepository
 * and DeviceRepository here would NOT be atomic across both.
 */
export interface EnrollmentRepository {
  enrollDevice(
    tokenHash: string,
    platform: Platform,
    publicKey: string,
    deviceId: string,
    keyId: string,
    now: Date,
  ): Promise<EnrollDeviceOutcome>;
}
