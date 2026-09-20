import type { GenesisChallengeRecord } from './genesisProtocol.js';
import type { ConsumeGenesisChallengeResult, GenesisChallengeRepository } from './GenesisChallengeRepository.js';

export class InMemoryGenesisChallengeRepository implements GenesisChallengeRepository {
  private readonly records = new Map<string, GenesisChallengeRecord>();

  async create(record: GenesisChallengeRecord): Promise<void> {
    if (this.records.has(record.challengeId)) throw new Error('duplicate_genesis_challenge');
    this.records.set(record.challengeId, { ...record });
  }

  async findById(challengeId: string): Promise<GenesisChallengeRecord | null> {
    const record = this.records.get(challengeId);
    return record ? { ...record } : null;
  }

  async consumeAtomically(challengeId: string, consumedAt: Date): Promise<ConsumeGenesisChallengeResult> {
    const record = this.records.get(challengeId);
    if (!record) return { outcome: 'NOT_FOUND' };
    if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
    if (record.expiresAt.getTime() <= consumedAt.getTime()) return { outcome: 'EXPIRED' };
    const consumed = { ...record, consumedAt };
    this.records.set(challengeId, consumed);
    return { outcome: 'CONSUMED', challenge: { ...consumed } };
  }
}
