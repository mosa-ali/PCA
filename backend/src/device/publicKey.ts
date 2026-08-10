const PUBLIC_KEY_SHAPE = /^[A-Za-z0-9_-]+$/;
const MIN_DECODED_BYTES = 16;
const MAX_DECODED_BYTES = 256;

/**
 * Devices generate their own keypairs locally and submit only the public
 * key here for registration. This module never generates or handles a
 * private key -- it only shape-validates an untrusted, attacker-controlled
 * public-key blob before it is persisted.
 */
export function isPlausiblePublicKey(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || !PUBLIC_KEY_SHAPE.test(candidate)) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(candidate, 'base64url');
  } catch {
    return false;
  }
  if (decoded.length < MIN_DECODED_BYTES || decoded.length > MAX_DECODED_BYTES) return false;
  // Buffer.from(..., 'base64url') silently ignores invalid characters rather than
  // throwing, so re-encode and compare to reject anything that wasn't clean base64url.
  return decoded.toString('base64url') === candidate.replace(/=+$/, '');
}
