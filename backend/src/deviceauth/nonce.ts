import { randomBytes } from 'node:crypto';

const NONCE_BYTES = 32; // 256 bits of entropy
// randomBytes(32).toString('base64url') always yields exactly 43 characters
// (10 full 3-byte groups -> 40 chars, plus 3 chars for the trailing 2 bytes,
// unpadded). Validation matches this canonical shape exactly.
const CANONICAL_NONCE_LENGTH = 43;
const NONCE_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${CANONICAL_NONCE_LENGTH}}$`);

/** Generates a fresh, high-entropy, single-use challenge nonce using the platform CSPRNG. Never Math.random() or a hand-rolled generator. */
export function generateChallengeNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

export function isPlausibleChallengeNonce(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && NONCE_SHAPE.test(candidate);
}
