import { randomBytes, randomUUID } from 'node:crypto';
import type { FamilyAuthorityRequestChallengeRepository, FamilyAuthorityRequestChallengeRecord } from './FamilyAuthorityRequestChallengeRepository.js';
import {
  AUTHORITY_REQUEST_PROOF_VERSION,
  canonicalizeFamilyAuthorityRequestProof,
  type FamilyAuthorityRequestProofFields,
} from './requestProofProtocol.js';

export const FAMILY_AUTHORITY_REQUEST_CHALLENGE_TTL_MS = 60 * 1000;

export interface IssueFamilyAuthorityRequestChallengeInput {
  serviceAccountId: string;
  familyId: string;
  deviceId: string;
  keyId: string;
  publicKey: string;
  operation: string;
  requestDigest: string;
}

/** Source-only operation challenge service; production route wiring is intentionally absent in R1. */
export class FamilyAuthorityRequestChallengeService {
  constructor(
    private readonly repository: FamilyAuthorityRequestChallengeRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(input: IssueFamilyAuthorityRequestChallengeInput): Promise<FamilyAuthorityRequestChallengeRecord> {
    const issuedAt = this.now();
    const record: FamilyAuthorityRequestChallengeRecord = {
      protocolVersion: AUTHORITY_REQUEST_PROOF_VERSION,
      operation: input.operation,
      serviceAccountId: input.serviceAccountId,
      familyId: input.familyId,
      deviceId: input.deviceId,
      keyId: input.keyId,
      publicKey: input.publicKey,
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString('base64url'),
      requestDigest: input.requestDigest,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + FAMILY_AUTHORITY_REQUEST_CHALLENGE_TTL_MS),
      consumedAt: null,
    };
    canonicalizeFamilyAuthorityRequestProof(record);
    await this.repository.create(record);
    return record;
  }

  async consume(fields: FamilyAuthorityRequestProofFields & { consumedAt: Date }): Promise<boolean> {
    try {
      canonicalizeFamilyAuthorityRequestProof(fields);
    } catch {
      return false;
    }
    const result = await this.repository.consumeAtomically(fields, fields.consumedAt);
    return result.outcome === 'CONSUMED';
  }
}
