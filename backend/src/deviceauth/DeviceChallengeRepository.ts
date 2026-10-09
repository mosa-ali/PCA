import type { ChallengeId, DeviceChallengeRecord } from './types.js';

export type ConsumeChallengeResult =
  | { outcome: 'CONSUMED'; challenge: DeviceChallengeRecord }
  | { outcome: 'SIGNER_KEY_INACTIVE' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'ALREADY_CONSUMED' };

/** Exact key identity whose proof has already been verified for this challenge. */
export interface VerifiedChallengeSigner {
  familyId: string;
  deviceId: string;
  keyId: string;
  publicKey: string;
}

/**
 * Persistence port for device-authentication challenges. A deterministic
 * in-memory implementation exists for tests; MySqlDeviceChallengeRepository
 * is the production implementation and must not be faked or assumed here.
 *
 * consumeAtomically MUST guarantee exactly one caller ever observes
 * CONSUMED for a given challenge, even under concurrent verification
 * attempts with the same (replayed) signature. It must also revalidate the
 * exact verified DSK (device, family, key id, public key, purpose and ACTIVE
 * status) in the same transaction/atomic boundary before consuming. This
 * closes key-revocation between service lookup/signature verification and
 * challenge consumption.
 */
export interface DeviceChallengeRepository {
  create(record: DeviceChallengeRecord): Promise<void>;
  findById(challengeId: ChallengeId): Promise<DeviceChallengeRecord | null>;
  consumeAtomically(
    challengeId: ChallengeId,
    consumedAt: Date,
    verifiedSigner: VerifiedChallengeSigner,
  ): Promise<ConsumeChallengeResult>;
}
