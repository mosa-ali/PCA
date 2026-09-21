import { createHash } from 'node:crypto';
import { isCanonicalBase64Url as isStrictCanonicalBase64Url, isCanonicalP256PublicKey } from '../../deviceauth/P256DeviceSignatureVerifier.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';

export const AUTHORITY_REQUEST_PROOF_VERSION = 1 as const;
export const AUTHORITY_REQUEST_PROOF_DOMAIN = 'PCA_FAMILY_AUTHORITY_REQUEST_PROOF_V1' as const;

export interface FamilyAuthorityRequestProofFields {
  protocolVersion: typeof AUTHORITY_REQUEST_PROOF_VERSION;
  operation: string;
  serviceAccountId: string;
  familyId: OpaqueFamilyId;
  deviceId: OpaqueDeviceId;
  keyId: string;
  publicKey: string;
  challengeId: string;
  nonce: string;
  requestDigest: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** Fixed UTF-8 netstrings; no JSON or caller-supplied message is accepted. */
export function canonicalizeFamilyAuthorityRequestProof(input: FamilyAuthorityRequestProofFields): string {
  if (input.protocolVersion !== AUTHORITY_REQUEST_PROOF_VERSION) throw new Error('invalid_authority_request_protocol');
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.operation)) throw new Error('invalid_authority_request_operation');
  if (!isCanonicalP256PublicKey(input.publicKey)) throw new Error('invalid_authority_request_public_key');
  if (!isCanonicalBase64Url(input.nonce, 43)) throw new Error('invalid_authority_request_nonce');
  if (!isCanonicalBase64Url(input.requestDigest, 43)) throw new Error('invalid_authority_request_digest');
  const fields = [
    AUTHORITY_REQUEST_PROOF_DOMAIN,
    String(input.protocolVersion),
    input.operation,
    input.serviceAccountId,
    input.familyId,
    input.deviceId,
    input.keyId,
    input.publicKey,
    input.challengeId,
    input.nonce,
    input.requestDigest,
    input.issuedAt.toISOString(),
    input.expiresAt.toISOString(),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

export function digestAuthorityRequestBody(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('base64url');
}

function isCanonicalBase64Url(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && isStrictCanonicalBase64Url(value, 32);
}
