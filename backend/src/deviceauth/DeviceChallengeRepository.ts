import type { ChallengeId, DeviceChallengeRecord } from './types.js';

export type ConsumeChallengeResult =
  | { outcome: 'CONSUMED'; challenge: DeviceChallengeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'ALREADY_CONSUMED' };

/**
 * Persistence port for device-authentication challenges. Only a
 * deterministic in-memory implementation exists for now (test support);
 * the PostgreSQL implementation is a separate, later slice and must not be
 * faked or assumed here.
 *
 * consumeAtomically MUST guarantee exactly one caller ever observes
 * CONSUMED for a given challenge, even under concurrent verification
 * attempts with the same (replayed) signature -- this is the replay-
 * protection boundary, mirroring InvitationRepository.redeemAtomically.
 */
export interface DeviceChallengeRepository {
  create(record: DeviceChallengeRecord): Promise<void>;
  findById(challengeId: ChallengeId): Promise<DeviceChallengeRecord | null>;
  consumeAtomically(challengeId: ChallengeId, consumedAt: Date): Promise<ConsumeChallengeResult>;
}
