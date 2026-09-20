import { randomBytes, randomUUID } from 'node:crypto';
import { isCanonicalP256PublicKey } from '../deviceauth/P256DeviceSignatureVerifier.js';
import type { ParentAccountId } from './types.js';

export const GENESIS_PROTOCOL_VERSION = 1 as const;
export const GENESIS_OPERATION = 'GENESIS' as const;
export const GENESIS_DOMAIN = 'PCA_FAMILY_GENESIS_PROOF_V1' as const;
export const GENESIS_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface GenesisChallengeRecord {
  challengeId: string;
  accountId: ParentAccountId;
  serviceAccountId: string;
  familyId: string;
  candidateDeviceId: string;
  candidateKeyId: string;
  candidatePublicKey: string;
  nonce: string;
  operation: typeof GENESIS_OPERATION;
  protocolVersion: typeof GENESIS_PROTOCOL_VERSION;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface GenesisProofInput {
  protocolVersion: typeof GENESIS_PROTOCOL_VERSION;
  operation: typeof GENESIS_OPERATION;
  accountId: ParentAccountId;
  serviceAccountId: string;
  familyId: string;
  deviceId: string;
  keyId: string;
  publicKey: string;
  challengeId: string;
  nonce: string;
  createdAt: Date;
  expiresAt: Date;
}

export function createGenesisChallengeIds(): { challengeId: string; familyId: string; deviceId: string; keyId: string; nonce: string } {
  return {
    challengeId: randomUUID(),
    familyId: randomUUID(),
    deviceId: randomUUID(),
    keyId: randomUUID(),
    nonce: randomBytes(32).toString('base64url'),
  };
}

/** Fixed-order UTF-8 netstrings; never JSON.stringify. */
export function canonicalizeGenesisProof(input: GenesisProofInput): string {
  if (input.protocolVersion !== GENESIS_PROTOCOL_VERSION || input.operation !== GENESIS_OPERATION) throw new Error('invalid_genesis_protocol');
  if (!isCanonicalP256PublicKey(input.publicKey)) throw new Error('invalid_genesis_public_key');
  if (!isCanonicalNonce(input.nonce)) throw new Error('invalid_genesis_nonce');
  const fields = [
    GENESIS_DOMAIN,
    String(input.protocolVersion),
    input.operation,
    input.accountId,
    input.serviceAccountId,
    input.familyId,
    input.deviceId,
    input.keyId,
    input.publicKey,
    input.challengeId,
    input.nonce,
    input.createdAt.toISOString(),
    input.expiresAt.toISOString(),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

export function isCanonicalNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
