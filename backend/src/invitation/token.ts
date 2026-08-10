import { randomBytes, createHash } from 'node:crypto';

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy
// randomBytes(32).toString('base64url') always yields exactly 43 characters
// (10 full 3-byte groups -> 40 chars, plus 3 chars for the trailing 2 bytes,
// unpadded). Validation matches this canonical shape exactly rather than
// accepting a broader grammar with no concrete compatibility need.
const CANONICAL_TOKEN_LENGTH = 43;
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${CANONICAL_TOKEN_LENGTH}}$`);

export interface GeneratedInvitationToken {
  rawToken: string;
  tokenHash: string;
}

/**
 * Generates a high-entropy, URL-safe bearer token for one-time enrollment
 * invitations using the platform CSPRNG. Never use Math.random() or a
 * hand-rolled generator for this value.
 */
export function generateInvitationToken(): GeneratedInvitationToken {
  const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  return { rawToken, tokenHash: hashInvitationToken(rawToken) };
}

/**
 * One-way reference for persistence/lookup. The raw token itself must never
 * be stored; this hash is what the repository indexes and compares against.
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function isPlausibleInvitationToken(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && TOKEN_SHAPE.test(candidate);
}
