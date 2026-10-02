import { createHash } from 'node:crypto';

/**
 * Wave 6B-R1 (finding R1-01): the canonical committed-submission identity.
 *
 * The durable idempotency identity of a bootstrap submission MUST cover
 * every security-relevant byte of the cryptographic request and must be
 * unambiguous. The original Wave-6B digest was an LF-delimited concatenation
 * of proofBytes / epoch1Bytes / epoch1Signature / evidence that (a) omitted
 * `proofSignature` entirely -- so a committed ceremony accepted a replay
 * whose proof signature bytes differed -- and (b) allowed cross-field
 * byte-shifting (any LF content could move between adjacent fields without
 * changing the concatenation), and (c) aliased `null` and `''` evidence.
 *
 * This module replaces it with a domain-separated, length-prefixed
 * (netstring-style) canonical encoding whose byte-length prefixes pin every
 * field boundary, so the 7-tuple -> canonical-bytes mapping is injective:
 * any change to ANY component changes the canonical bytes and therefore the
 * digest (modulo SHA-256 collision resistance). An explicit evidence-presence
 * flag keeps `null` (absent) and `''` (empty string) structurally distinct.
 *
 * Domain: PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1 -- distinct from the
 * PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof domain and the epoch grammar, so no
 * canonical string can be reinterpreted across statements.
 *
 * The digest is computed over the exact UTF-8 bytes of the canonical string
 * (the same byte domain every verifier in this module family consumes).
 * Malformed input (non-string components, non-string/non-null evidence)
 * throws -- callers must fail closed and never digest partially validated
 * material.
 */

export const BOOTSTRAP_COMMIT_DOMAIN = 'PCA_FIRST_DEVICE_BOOTSTRAP_COMMIT_V1';

export interface FirstDeviceBootstrapCommitComponents {
  proofBytes: string;
  proofSignature: string;
  epoch1Bytes: string;
  epoch1Signature: string;
  attestationEvidence: string | null;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`first-device bootstrap commit component ${name} must be a string.`);
  }
  return value;
}

/**
 * Canonical committed-submission byte string. Field order is fixed and every
 * field is emitted as `<utf8-byte-length>:<value>` (netstring style). The
 * evidence presence flag ('1' present, '0' absent) is derived internally
 * from `attestationEvidence === null` -- it is never caller-supplied -- and
 * the evidence VALUE field is always emitted (empty string when absent), so
 * `null` and `''` can never collide.
 */
export function canonicalizeFirstDeviceBootstrapCommit(components: FirstDeviceBootstrapCommitComponents): string {
  const proofBytes = requireString(components.proofBytes, 'proofBytes');
  const proofSignature = requireString(components.proofSignature, 'proofSignature');
  const epoch1Bytes = requireString(components.epoch1Bytes, 'epoch1Bytes');
  const epoch1Signature = requireString(components.epoch1Signature, 'epoch1Signature');
  const evidence = components.attestationEvidence;
  if (evidence !== null && typeof evidence !== 'string') {
    throw new TypeError('first-device bootstrap commit component attestationEvidence must be a string or null.');
  }
  const fields = [
    BOOTSTRAP_COMMIT_DOMAIN,
    proofBytes,
    proofSignature,
    epoch1Bytes,
    epoch1Signature,
    evidence === null ? '0' : '1',
    evidence ?? '',
  ];
  return fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
}

/** SHA-256 (lowercase hex) over the exact canonical committed-submission bytes. */
export function computeFirstDeviceBootstrapCommitDigest(components: FirstDeviceBootstrapCommitComponents): string {
  return createHash('sha256').update(Buffer.from(canonicalizeFirstDeviceBootstrapCommit(components), 'utf8')).digest('hex');
}
