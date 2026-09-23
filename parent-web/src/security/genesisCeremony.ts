// FAMILY GENESIS ceremony (PCA-DEC-020-R1).
//
// Verification establishes ACCOUNT IDENTITY ONLY. A family is created by this
// separate, explicit, cryptographically-bound ceremony, in which the browser
// becomes the family's FIRST TRUSTED PARENT by signing with a non-extractable
// P-256 endpoint key generated in this tab and never exported.
//
// This module owns exactly one job: turn a server-issued GenesisChallenge into
// the three signatures + epoch/TTL window the backend verifies. It does NOT
// invent protocol fields, does NOT re-derive anything the server already
// stated, and does NOT persist key material.
//
// Every signed value is copied FROM the challenge. That is deliberate: the
// server signs a statement about what it issued, so a client that recomputed
// (say) the family id or the challenge expiry would be signing a different
// statement than the one the server will verify.

import { generateEndpointSigningKey } from './trustedEndpointKeyStore';
import { signGenesisAnchor, signGenesisProof, signOwnerAttestation } from './genesisProof';
import { reportDiagnostic } from './diagnosticConsole';
import type { GenesisChallenge, GenesisCompletionInput } from '../api/interfaces';

/** Must match backend `GENESIS_PROTOCOL_VERSION`. */
const SUPPORTED_PROTOCOL_VERSION = 1;
/**
 * Genesis epoch/revision constants, matching
 * backend/scripts/lib/completeFamilyGenesis.mjs -- the authoritative working
 * driver for this ceremony. A brand-new family has exactly one trust set and
 * one key epoch, and its first owner attestation is revision 1.
 */
const GENESIS_TRUST_SET_EPOCH = 1;
const GENESIS_KEY_EPOCH = 1;
const GENESIS_ATTESTATION_REVISION = 1;
/**
 * Owner-attestation lifetime.
 *
 * backend/src/familycommercial/authority/policy.ts accepts a TTL in
 * [MIN_ATTESTATION_TTL_MS = 1s, MAX_ATTESTATION_TTL_MS = 30d] and additionally
 * rejects any attestation whose `issuedAt` is more than ATTESTATION_CLOCK_SKEW_MS
 * (5 min) in the future or older than MAX_ATTESTATION_TTL_MS. One hour sits
 * comfortably inside every bound.
 *
 * Deliberately NOT tied to the challenge's own lifetime: the challenge expires
 * in ~10 minutes because it exists only to bind ONE interactive ceremony,
 * whereas the attestation it produces is a durable authority record about who
 * owns the family. Reusing the short challenge window here would mint an owner
 * authority record that expires minutes after the family is created.
 */
const ATTESTATION_TTL_MS = 60 * 60 * 1000;

export interface GenesisDeviceKey {
  /** SEC1 uncompressed point (0x04 || X || Y), base64url without padding -- the exact encoding the protocol signs over. */
  publicKey: string;
  /** SHA-256 fingerprint of the exported public key JWK, hex. Public data: safe to display for out-of-band comparison. */
  fingerprint: string;
}

function base64UrlNoPadding(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Converts the WebCrypto-exported JWK coordinate pair into the SEC1
 * uncompressed point the genesis protocol signs over.
 *
 * This conversion is required and not cosmetic. Endpoint key material is
 * generated `extractable: false`, so the private scalar can never be exported
 * -- but `crypto.subtle.exportKey('jwk', publicKey)` yields the PUBLIC point as
 * base64url X and Y of 32 bytes each, while every canonicalizer in
 * security/genesisProof.ts validates `isStrictCanonicalBase64Url(key, 65)`:
 * the 65-byte uncompressed form. Passing the JWK (or its JSON) straight
 * through would fail that check, or worse, produce bytes over which the
 * backend derives a different key id than the one it issued.
 *
 * Neither X nor Y is secret; the private scalar never leaves WebCrypto, and
 * this function only ever touches the public key.
 */
export function jwkToUncompressedPoint(jwk: JsonWebKey): string {
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('invalid_endpoint_public_key_jwk');
  }
  const x = decodeBase64Url(jwk.x);
  const y = decodeBase64Url(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error('invalid_endpoint_public_key_jwk');
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return base64UrlNoPadding(point);
}

/**
 * Generates the device key this browser will use to become the family's
 * genesis device, and returns its public half in protocol encoding.
 *
 * PRIVACY/SAFETY NOTE: this intentionally does NOT persist the key across
 * reloads. The key handle lives in memory for the tab's lifetime only, so a
 * reload mid-ceremony requires starting the ceremony again -- which is the safe
 * direction to fail. A half-persisted genesis key is a much worse outcome than
 * a repeated ceremony, and the backend rejects a replay of an already-consumed
 * challenge anyway.
 */
export async function createGenesisDeviceKey(): Promise<GenesisDeviceKey> {
  const generated = await generateEndpointSigningKey();
  return {
    publicKey: jwkToUncompressedPoint(generated.publicKeyJwk),
    fingerprint: generated.fingerprint,
  };
}

/**
 * Signs the challenge into the completion payload.
 *
 * The same device and key appear as owner, signer and genesis device: this is
 * the family's FIRST authority record, and the first trusted parent is the
 * device creating it. `previousAttestationId` is null because there is no
 * earlier attestation in the chain -- revision 1 is the origin.
 */
export async function buildGenesisCompletion(challenge: GenesisChallenge): Promise<GenesisCompletionInput> {
  if (challenge.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    throw new Error('unsupported_genesis_protocol_version');
  }

  // `protocolVersion: 1` is the literal `GenesisProofFields.protocolVersion`
  // requires; the guard above is what makes passing the literal sound rather
  // than an unchecked cast.
  const proofSignature = await signGenesisProof({
    protocolVersion: SUPPORTED_PROTOCOL_VERSION,
    operation: 'GENESIS',
    accountId: challenge.accountId,
    serviceAccountId: challenge.serviceAccountId,
    familyId: challenge.familyId,
    deviceId: challenge.deviceId,
    keyId: challenge.keyId,
    publicKey: challenge.publicKey,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
  });

  const anchorSignature = await signGenesisAnchor({
    familyId: challenge.familyId,
    genesisDeviceId: challenge.deviceId,
    genesisDskKeyId: challenge.keyId,
    genesisDskPublicKey: challenge.publicKey,
    protocolVersion: challenge.protocolVersion,
    createdAt: challenge.createdAt,
  });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ATTESTATION_TTL_MS);

  const attestationSignature = await signOwnerAttestation({
    familyId: challenge.familyId,
    attestationRevision: GENESIS_ATTESTATION_REVISION,
    ownerDeviceId: challenge.deviceId,
    ownerDskKeyId: challenge.keyId,
    ownerDskPublicKey: challenge.publicKey,
    trustSetEpoch: GENESIS_TRUST_SET_EPOCH,
    keyEpoch: GENESIS_KEY_EPOCH,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    previousAttestationId: null,
    signerDeviceId: challenge.deviceId,
    signerDskKeyId: challenge.keyId,
    signerDskPublicKey: challenge.publicKey,
  });

  reportDiagnostic('PARENT_GENESIS_STAGE', 'PROOF_SIGNED');

  return {
    challengeId: challenge.challengeId,
    proofSignature,
    anchorSignature,
    attestationSignature,
    trustSetEpoch: GENESIS_TRUST_SET_EPOCH,
    keyEpoch: GENESIS_KEY_EPOCH,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}
