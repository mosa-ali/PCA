import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,64}$/;

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

/** Constant-time comparison of two hex digests, for callers outside repository lookup paths. */
export function tokenHashesEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
