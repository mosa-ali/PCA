import type { GenesisStepUpAuthorization, GenesisStepUpRepository, NewGenesisStepUpAuthorization } from './GenesisStepUpRepository.js';

/** Deterministic test double; never used in production composition. */
export class InMemoryGenesisStepUpRepository implements GenesisStepUpRepository {
  private readonly records = new Map<string, GenesisStepUpAuthorization>();

  async create(record: NewGenesisStepUpAuthorization): Promise<void> {
    if (this.records.has(record.authorizationId)) throw new Error('duplicate_genesis_step_up_authorization');
    this.records.set(record.authorizationId, { ...record, attemptCount: 0, verifiedAt: null, consumedAt: null });
  }

  async findLatestForSession(input: { accountId: string; serviceAccountId: string; sessionIdHash: string }): Promise<GenesisStepUpAuthorization | null> {
    const rows = [...this.records.values()]
      .filter((row) => row.accountId === input.accountId && row.serviceAccountId === input.serviceAccountId && row.sessionIdHash === input.sessionIdHash)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? { ...rows[0] } : null;
  }

  async incrementAttempt(authorizationId: string): Promise<void> {
    const record = this.records.get(authorizationId);
    if (record) record.attemptCount += 1;
  }

  async verifyCodeAtomically(authorizationId: string, verifiedAt: Date): Promise<boolean> {
    const record = this.records.get(authorizationId);
    if (!record || record.verifiedAt || record.consumedAt || record.expiresAt.getTime() <= verifiedAt.getTime()) return false;
    record.verifiedAt = verifiedAt;
    return true;
  }

  async findVerifiedForSession(input: { accountId: string; serviceAccountId: string; sessionIdHash: string; now: Date }): Promise<GenesisStepUpAuthorization | null> {
    const rows = [...this.records.values()]
      .filter((row) => row.accountId === input.accountId && row.serviceAccountId === input.serviceAccountId && row.sessionIdHash === input.sessionIdHash && row.verifiedAt !== null && row.consumedAt === null && row.expiresAt.getTime() > input.now.getTime())
      .sort((a, b) => (b.verifiedAt?.getTime() ?? 0) - (a.verifiedAt?.getTime() ?? 0));
    return rows[0] ? { ...rows[0] } : null;
  }

  async consumeAtomically(input: { authorizationId: string; accountId: string; serviceAccountId: string; sessionIdHash: string; operation: 'FAMILY_GENESIS'; consumedAt: Date }): Promise<boolean> {
    const record = this.records.get(input.authorizationId);
    if (!record || record.accountId !== input.accountId || record.serviceAccountId !== input.serviceAccountId || record.sessionIdHash !== input.sessionIdHash || record.operation !== input.operation || record.verifiedAt === null || record.consumedAt !== null || record.expiresAt.getTime() <= input.consumedAt.getTime()) return false;
    record.consumedAt = input.consumedAt;
    return true;
  }
}
