import { createHash, randomBytes } from 'node:crypto';

/**
 * PCA-ADD-PA-014: Platform Administration session tokens are generated
 * exactly like backend/src/auth/token.ts's family-plane service tokens
 * (randomBytes(32).toString('base64url'), 256 bits of entropy) but with a
 * `pa_` prefix applied BEFORE hashing/returning, so the raw token itself
 * carries an audience marker every family-plane token parser rejects on
 * sight (backend/src/auth/token.ts's isPlausibleSessionToken never matches
 * a `pa_`-prefixed string), and this module's own
 * isPlausiblePlatformAdminSessionToken rejects any token missing that
 * prefix before ever attempting a hash lookup -- a service_sessions raw
 * token can never even reach this plane's database query.
 */
const RAW_TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'pa_';
const RAW_SEGMENT_LENGTH = 43; // randomBytes(32).toString('base64url') is always exactly 43 characters
const TOKEN_SHAPE = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{${RAW_SEGMENT_LENGTH}}$`);

export interface GeneratedPlatformAdminSessionToken {
  rawToken: string;
  tokenHash: string;
}

export function generatePlatformAdminSessionToken(): GeneratedPlatformAdminSessionToken {
  const rawToken = TOKEN_PREFIX + randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  return { rawToken, tokenHash: hashPlatformAdminSessionToken(rawToken) };
}

/** One-way reference for persistence/lookup. The raw token itself is never stored. */
export function hashPlatformAdminSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function isPlausiblePlatformAdminSessionToken(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && TOKEN_SHAPE.test(candidate);
}
