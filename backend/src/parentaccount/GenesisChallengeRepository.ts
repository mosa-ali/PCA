import type { GenesisChallengeRecord } from './genesisProtocol.js';

export type ConsumeGenesisChallengeResult =
  | { outcome: 'CONSUMED'; challenge: GenesisChallengeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'ALREADY_CONSUMED' }
  | { outcome: 'EXPIRED' };

export interface GenesisChallengeRepository {
  create(record: GenesisChallengeRecord): Promise<void>;
  findById(challengeId: string): Promise<GenesisChallengeRecord | null>;
  consumeAtomically(challengeId: string, consumedAt: Date): Promise<ConsumeGenesisChallengeResult>;
}
