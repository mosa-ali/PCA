import type { GenesisChallengeRepository } from './GenesisChallengeRepository.js';
import {
  canonicalizeGenesisProof,
  createGenesisChallengeIds,
  GENESIS_CHALLENGE_TTL_MS,
  type GenesisChallengeRecord,
} from './genesisProtocol.js';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import type { ParentAccountId } from './types.js';
import type { Platform } from '../device/types.js';

export type GenesisChallengeErrorCode =
  | 'INVALID_PUBLIC_KEY'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'INVALID_SIGNATURE';

export class GenesisChallengeError extends Error {
  readonly code: GenesisChallengeErrorCode;
  constructor(code: GenesisChallengeErrorCode) {
    super(code);
    this.name = 'GenesisChallengeError';
    this.code = code;
  }
}

export interface BeginGenesisChallengeInput {
  accountId: ParentAccountId;
  serviceAccountId: string;
  publicKey: string;
  platform?: Platform;
}

/**
 * Source-only challenge/proof boundary. The caller that owns the family,
 * device-directory, scope, and membership transaction must use the returned
 * consumed record in the same durable commit as genesis persistence. This
 * class never generates a private key and never grants a family role.
 */
export class GenesisChallengeService {
  constructor(
    private readonly repository: GenesisChallengeRepository,
    private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(input: BeginGenesisChallengeInput): Promise<GenesisChallengeRecord> {
    const ids = createGenesisChallengeIds();
    const createdAt = this.now();
    const record: GenesisChallengeRecord = {
      challengeId: ids.challengeId,
      accountId: input.accountId,
      serviceAccountId: input.serviceAccountId,
      familyId: ids.familyId,
      candidateDeviceId: ids.deviceId,
      candidateKeyId: ids.keyId,
      candidatePublicKey: input.publicKey,
      candidatePlatform: input.platform ?? 'BROWSER',
      nonce: ids.nonce,
      operation: 'GENESIS',
      protocolVersion: 1,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + GENESIS_CHALLENGE_TTL_MS),
      consumedAt: null,
    };
    try {
      // canonicalizeGenesisProof performs strict P-256 public-key validation.
      canonicalizeGenesisProof({
        protocolVersion: record.protocolVersion,
        operation: record.operation,
        accountId: record.accountId,
        serviceAccountId: record.serviceAccountId,
        familyId: record.familyId,
        deviceId: record.candidateDeviceId,
        keyId: record.candidateKeyId,
        publicKey: record.candidatePublicKey,
        challengeId: record.challengeId,
        nonce: record.nonce,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      });
    } catch {
      throw new GenesisChallengeError('INVALID_PUBLIC_KEY');
    }
    await this.repository.create(record);
    return record;
  }

  async complete(challengeId: string, signature: string): Promise<GenesisChallengeRecord> {
    await this.verifyProof(challengeId, signature);
    const consumed = await this.repository.consumeAtomically(challengeId, this.now());
    if (consumed.outcome === 'NOT_FOUND') throw new GenesisChallengeError('NOT_FOUND');
    if (consumed.outcome === 'EXPIRED') throw new GenesisChallengeError('EXPIRED');
    if (consumed.outcome === 'ALREADY_CONSUMED') throw new GenesisChallengeError('ALREADY_CONSUMED');
    return consumed.challenge;
  }

  /** Verifies the client proof without consuming the challenge. The atomic genesis coordinator calls this before handing the exact record to its single transaction. */
  async verifyProof(challengeId: string, signature: string): Promise<GenesisChallengeRecord> {
    const record = await this.repository.findById(challengeId);
    if (!record) throw new GenesisChallengeError('NOT_FOUND');
    const now = this.now();
    if (record.consumedAt) throw new GenesisChallengeError('ALREADY_CONSUMED');
    if (record.expiresAt.getTime() <= now.getTime()) throw new GenesisChallengeError('EXPIRED');

    const message = canonicalizeGenesisProof({
      protocolVersion: record.protocolVersion,
      operation: record.operation,
      accountId: record.accountId,
      serviceAccountId: record.serviceAccountId,
      familyId: record.familyId,
      deviceId: record.candidateDeviceId,
      keyId: record.candidateKeyId,
      publicKey: record.candidatePublicKey,
      challengeId: record.challengeId,
      nonce: record.nonce,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    if (!(await this.signatureVerifier.verify(record.candidatePublicKey, message, signature))) {
      throw new GenesisChallengeError('INVALID_SIGNATURE');
    }
    return record;
  }
}
