import type {
  ConsumeFamilyAuthorityRequestChallengeResult,
  FamilyAuthorityRequestChallengeRecord,
  FamilyAuthorityRequestChallengeRepository,
} from './FamilyAuthorityRequestChallengeRepository.js';
import type { FamilyAuthorityRequestProofFields } from './requestProofProtocol.js';

export class InMemoryFamilyAuthorityRequestChallengeRepository implements FamilyAuthorityRequestChallengeRepository {
  private readonly records = new Map<string, FamilyAuthorityRequestChallengeRecord>();

  async create(record: FamilyAuthorityRequestChallengeRecord): Promise<void> {
    if (this.records.has(record.challengeId)) throw new Error('duplicate_family_authority_request_challenge');
    this.records.set(record.challengeId, { ...record });
  }

  async findById(challengeId: string): Promise<FamilyAuthorityRequestChallengeRecord | null> {
    const record = this.records.get(challengeId);
    return record ? { ...record } : null;
  }

  async consumeAtomically(
    fields: FamilyAuthorityRequestProofFields,
    consumedAt: Date,
  ): Promise<ConsumeFamilyAuthorityRequestChallengeResult> {
    const record = this.records.get(fields.challengeId);
    if (!record) return { outcome: 'NOT_FOUND' };
    if (record.consumedAt) return { outcome: 'ALREADY_CONSUMED' };
    if (record.expiresAt.getTime() <= consumedAt.getTime()) return { outcome: 'EXPIRED' };
    if (!sameChallengeFields(record, fields)) return { outcome: 'MISMATCH' };
    const consumed = { ...record, consumedAt };
    this.records.set(record.challengeId, consumed);
    return { outcome: 'CONSUMED', challenge: { ...consumed } };
  }
}

function sameChallengeFields(
  left: FamilyAuthorityRequestChallengeRecord,
  right: FamilyAuthorityRequestProofFields,
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.operation === right.operation &&
    left.serviceAccountId === right.serviceAccountId &&
    left.familyId === right.familyId &&
    left.deviceId === right.deviceId &&
    left.keyId === right.keyId &&
    left.publicKey === right.publicKey &&
    left.challengeId === right.challengeId &&
    left.nonce === right.nonce &&
    left.requestDigest === right.requestDigest &&
    left.issuedAt.getTime() === right.issuedAt.getTime() &&
    left.expiresAt.getTime() === right.expiresAt.getTime()
  );
}
