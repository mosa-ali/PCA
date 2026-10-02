import { createHash, verify as cryptoVerify } from 'node:crypto';
import {
  createP256PublicKey,
  isCanonicalP256PublicKey,
  isCanonicalP256Signature,
  strictBase64Url,
} from '../deviceauth/P256DeviceSignatureVerifier.js';

/**
 * Wave 6B (owner rulings F4/D4): the domain-separated first-device bootstrap
 * proof. This is signature statement (A) of the F4 dual-signature model:
 *
 *   (A) this proof, signed by the proposed device DSK under the
 *       PCA_FIRST_DEVICE_BOOTSTRAP_V1 domain, binding the complete ceremony
 *       context and sha256 of the exact canonical epoch-1 bytes; and
 *   (B) the Trust Set epoch-1 signature, which continues to use the
 *       certified Wave-5B canonical epoch format (canonicalize.ts) and is
 *       verified against the same DSK.
 *
 * The two statements are cryptographically disjoint: the proof is a 13-field
 * netstring tuple led by an explicit domain literal, while an epoch is a
 * 6 + 7N field netstring with no domain tag, so neither signature can ever be
 * presented as the other (byte-identity is impossible between the two
 * grammars). Epoch-1 bytes are NEVER re-versioned by this module.
 *
 * Canonical encoding is the same netstring-style length-prefixed UTF-8 scheme
 * as canonicalize.ts: no field value can be crafted to make two structurally
 * different proofs canonicalize to the same byte string. `decode` enforces
 * the exact 13-field shape, canonical length prefixes, full consumption and
 * byte-identity of a re-encode — a non-canonical or ambiguous payload is
 * rejected outright.
 */

export const BOOTSTRAP_PROOF_DOMAIN = 'PCA_FIRST_DEVICE_BOOTSTRAP_V1';
export const BOOTSTRAP_PROTOCOL_VERSION = 1;
/** Anchor row protocol_version for ceremony-created roots (identifies the PCA_FAMILY_TRUST_ROOT_V1 scheme together with the anchor's signature_scheme column). */
export const TRUST_ROOT_PROTOCOL_VERSION = 1;
export const ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE = 'PCA_FIRST_DEVICE_BOOTSTRAP_V1';
export const DSK_ALGORITHM = 'ECDSA_P256_SHA256';
/** Upper bound for the opaque proof blob, kept well below the 256 KiB epoch ceiling. */
export const MAX_BOOTSTRAP_PROOF_BYTES = 16_384;
/** Short-lived one-time ceremony challenge window. */
export const BOOTSTRAP_CHALLENGE_TTL_MS = 10 * 60_000;

export interface FirstDeviceBootstrapProofFields {
  familyId: string;
  deviceId: string;
  ceremonyId: string;
  challengeId: string;
  nonce: string;
  expiresAt: Date;
  dskKeyId: string;
  dskPublicKey: string;
  /** Lowercase hex sha256 of the exact canonical epoch-1 byte string being signed (statement B). */
  epoch1Sha256Hex: string;
  /** Lowercase hex digest of the attestation evidence, or null when no evidence is bound. */
  attestationEvidenceDigest: string | null;
}

export class FirstDeviceBootstrapProofError extends Error {
  readonly code = 'MALFORMED_BOOTSTRAP_PROOF';
  constructor(message: string) {
    super(`Malformed first-device bootstrap proof: ${message}`);
  }
}

const ID_36 = /^[A-Za-z0-9-]{36}$/;
const NONCE_43 = /^[A-Za-z0-9_-]{43}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalizeFirstDeviceBootstrapProof(fields: FirstDeviceBootstrapProofFields): string {
  const values = [
    BOOTSTRAP_PROOF_DOMAIN,
    String(BOOTSTRAP_PROTOCOL_VERSION),
    fields.familyId,
    fields.deviceId,
    fields.ceremonyId,
    fields.challengeId,
    fields.nonce,
    fields.expiresAt.toISOString(),
    DSK_ALGORITHM,
    fields.dskKeyId,
    fields.dskPublicKey,
    fields.epoch1Sha256Hex,
    fields.attestationEvidenceDigest === null ? 'null' : fields.attestationEvidenceDigest,
  ];
  return values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
}

function malformed(message: string): FirstDeviceBootstrapProofError {
  return new FirstDeviceBootstrapProofError(message);
}

/**
 * Strict decoder for the canonical proof byte string. Byte-walks the UTF-8
 * encoding (length prefixes are BYTE lengths), rejects non-numeric /
 * leading-zero / mismatched prefixes, requires exactly 13 fields and full
 * consumption, validates every field, and finally re-encodes from the decoded
 * fields and requires byte-identity with the input.
 */
export function decodeFirstDeviceBootstrapProof(input: unknown): FirstDeviceBootstrapProofFields {
  if (typeof input !== 'string' || input.length === 0) {
    throw malformed('proof must be a non-empty string.');
  }
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length > MAX_BOOTSTRAP_PROOF_BYTES) {
    throw malformed(`proof exceeds ${MAX_BOOTSTRAP_PROOF_BYTES} bytes.`);
  }

  const fields: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let colon = offset;
    while (colon < bytes.length && bytes[colon] !== 0x3a) {
      const byte = bytes[colon];
      if (byte < 0x30 || byte > 0x39) throw malformed('length prefix must be digits.');
      colon += 1;
    }
    if (colon === offset) throw malformed('missing length prefix.');
    if (colon >= bytes.length) throw malformed('unterminated length prefix.');
    const prefix = bytes.toString('ascii', offset, colon);
    if (prefix.length > 1 && prefix.startsWith('0')) throw malformed('non-canonical length prefix.');
    const length = Number.parseInt(prefix, 10);
    if (!Number.isSafeInteger(length) || length < 0) throw malformed('invalid length prefix.');
    const start = colon + 1;
    const end = start + length;
    if (end > bytes.length) throw malformed('truncated field.');
    fields.push(bytes.toString('utf8', start, end));
    offset = end;
  }
  if (fields.length !== 13) throw malformed(`expected exactly 13 fields, got ${fields.length}.`);

  const [
    domain,
    version,
    familyId,
    deviceId,
    ceremonyId,
    challengeId,
    nonce,
    expiresAtIso,
    dskAlgorithm,
    dskKeyId,
    dskPublicKey,
    epoch1Sha256Hex,
    attestationRaw,
  ] = fields;

  if (domain !== BOOTSTRAP_PROOF_DOMAIN) throw malformed('unexpected domain.');
  if (version !== String(BOOTSTRAP_PROTOCOL_VERSION)) throw malformed('unsupported protocol version.');
  if (familyId.length < 1 || familyId.length > 128) throw malformed('familyId must be 1..128 characters.');
  if (!ID_36.test(deviceId)) throw malformed('deviceId must be a 36-character opaque id.');
  if (!ID_36.test(ceremonyId)) throw malformed('ceremonyId must be a 36-character opaque id.');
  if (!ID_36.test(challengeId)) throw malformed('challengeId must be a 36-character opaque id.');
  if (!NONCE_43.test(nonce)) throw malformed('nonce must be 43 base64url characters.');
  const expiresAt = new Date(expiresAtIso);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== expiresAtIso) {
    throw malformed('expiresAt must be an exact ISO-8601 UTC timestamp.');
  }
  if (dskAlgorithm !== DSK_ALGORITHM) throw malformed('unsupported DSK algorithm.');
  if (!ID_36.test(dskKeyId)) throw malformed('dskKeyId must be a 36-character opaque id.');
  if (!isCanonicalP256PublicKey(dskPublicKey)) throw malformed('dskPublicKey must be a canonical SEC1 uncompressed P-256 point.');
  if (!HEX_64.test(epoch1Sha256Hex)) throw malformed('epoch1Sha256Hex must be lowercase hex sha256.');
  if (attestationRaw !== 'null' && !HEX_64.test(attestationRaw)) {
    throw malformed('attestation evidence digest must be lowercase hex sha256 or the literal null.');
  }

  const decoded: FirstDeviceBootstrapProofFields = {
    familyId,
    deviceId,
    ceremonyId,
    challengeId,
    nonce,
    expiresAt,
    dskKeyId,
    dskPublicKey,
    epoch1Sha256Hex,
    attestationEvidenceDigest: attestationRaw === 'null' ? null : attestationRaw,
  };

  if (canonicalizeFirstDeviceBootstrapProof(decoded) !== input) {
    throw malformed('non-canonical encoding (re-encode is not byte-identical).');
  }
  return decoded;
}

/**
 * Verifies the bootstrap proof signature over `canonicalBytes` (the output of
 * canonicalizeFirstDeviceBootstrapProof) using the same strict P-256
 * acceptance surface as every other verifier in the repository: SEC1
 * uncompressed key, IEEE-P1363 64-byte r||s, low-S only, unpadded canonical
 * base64url. Returns false for any malformed input, never throws.
 */
export function verifyFirstDeviceBootstrapProofSignature(
  publicKey: string,
  canonicalBytes: string,
  signature: string,
): boolean {
  try {
    if (!isCanonicalP256PublicKey(publicKey)) return false;
    if (!isCanonicalP256Signature(signature)) return false;

    const keyObject = createP256PublicKey(strictBase64Url(publicKey));
    return cryptoVerify(
      'sha256',
      Buffer.from(canonicalBytes, 'utf8'),
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      strictBase64Url(signature),
    );
  } catch {
    return false;
  }
}
