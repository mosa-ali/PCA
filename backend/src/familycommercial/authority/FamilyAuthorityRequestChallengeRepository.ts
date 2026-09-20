import type { FamilyAuthorityRequestProofFields } from './requestProofProtocol.js';

export type FamilyAuthorityRequestChallengeRecord = FamilyAuthorityRequestProofFields & {
  consumedAt: Date | null;
};

export type ConsumeFamilyAuthorityRequestChallengeResult =
  | { outcome: 'CONSUMED'; challenge: FamilyAuthorityRequestChallengeRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'ALREADY_CONSUMED' }
  | { outcome: 'MISMATCH' };

export interface FamilyAuthorityRequestChallengeRepository {
  create(record: FamilyAuthorityRequestChallengeRecord): Promise<void>;
  findById(challengeId: string): Promise<FamilyAuthorityRequestChallengeRecord | null>;
  consumeAtomically(
    fields: FamilyAuthorityRequestProofFields,
    consumedAt: Date,
  ): Promise<ConsumeFamilyAuthorityRequestChallengeResult>;
}
