import type { FamilyAuthorityGenesisAnchor, FamilyOwnerAttestation } from '../familycommercial/authority/types.js';
import type { GenesisChallengeRecord } from './genesisProtocol.js';

export interface GenesisCompletionArtifacts {
  readonly challenge: GenesisChallengeRecord;
  readonly anchor: FamilyAuthorityGenesisAnchor;
  readonly attestation: FamilyOwnerAttestation;
  readonly attestationId: string;
  readonly consumedAt: Date;
}

export type GenesisTransactionFailureCode =
  | 'CHALLENGE_NOT_FOUND'
  | 'CHALLENGE_ALREADY_CONSUMED'
  | 'CHALLENGE_EXPIRED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ALREADY_BOUND'
  | 'SERVICE_ACCOUNT_NOT_FOUND'
  | 'GENESIS_ALREADY_EXISTS'
  | 'INVALID_ATOMIC_STATE';

export class GenesisTransactionError extends Error {
  readonly code: GenesisTransactionFailureCode;

  constructor(code: GenesisTransactionFailureCode) {
    super(code);
    this.name = 'GenesisTransactionError';
    this.code = code;
  }
}

/**
 * One durable boundary for first-family genesis. Implementations MUST keep
 * challenge consumption, identity binding, device/DSK registration, service
 * scope, Administrator membership, and the authority anchor/chain rows in
 * the same transaction. There is intentionally no method for committing any
 * subset of these effects.
 */
export interface GenesisTransactionRepository {
  completeAtomically(input: GenesisCompletionArtifacts): Promise<void>;
}
