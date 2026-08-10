import { randomBytes, createHash } from 'node:crypto';

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy
// randomBytes(32).toString('base64url') always yields exactly 43 characters
// -- see backend/src/invitation/token.ts for the same reasoning. Matching
// the canonical shape exactly from the start this time (PG-CORR-2 fixed
// this after the fact for invitations).
const CANONICAL_TOKEN_LENGTH = 43;
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${CANONICAL_TOKEN_LENGTH}}$`);

export interface GeneratedSessionToken {
  rawToken: string;
  tokenHash: string;
}

export function generateSessionToken(): GeneratedSessionToken {
  const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  return { rawToken, tokenHash: hashSessionToken(rawToken) };
}

/** One-way reference for persistence/lookup. The raw token itself is never stored. */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function isPlausibleSessionToken(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && TOKEN_SHAPE.test(candidate);
}
