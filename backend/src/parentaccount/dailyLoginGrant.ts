import { createHash, randomBytes } from 'node:crypto';

const RAW_TOKEN_BYTES = 32;
const CANONICAL_TOKEN_LENGTH = 43;
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${CANONICAL_TOKEN_LENGTH}}$`);
const HASH_DOMAIN = 'PCA_PARENT_DAILY_LOGIN_GRANT_V1\0';

export interface GeneratedDailyLoginGrant {
  rawToken: string;
  tokenHash: string;
}

/** Creates an opaque browser grant; only its domain-separated SHA-256 hash is persisted. */
export function generateDailyLoginGrant(): GeneratedDailyLoginGrant {
  const rawToken = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
  return { rawToken, tokenHash: hashDailyLoginGrant(rawToken) };
}

export function hashDailyLoginGrant(rawToken: string): string {
  return createHash('sha256').update(HASH_DOMAIN, 'utf8').update(rawToken, 'utf8').digest('hex');
}

export function isPlausibleDailyLoginGrant(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && TOKEN_SHAPE.test(candidate);
}
