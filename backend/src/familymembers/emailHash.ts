import { createHash } from 'node:crypto';

/**
 * SHA-256 of the normalized-lowercase invited email. Deliberately an
 * INDEPENDENT re-implementation of parentaccount/emailHash.ts's
 * hashParentEmail rather than an import from it -- this codebase's own
 * precedent (see that file's doc comment, citing PCA_IMPL_DECISION_003) is
 * that each identity domain re-implements identical email-hashing logic
 * rather than sharing one function/code path across domains, even though
 * the algorithm is intentionally identical. Never stored or logged as raw
 * plaintext anywhere in this domain.
 */
export function hashInvitedEmail(email: string): Buffer {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 4.5.3.1.3

export function isPlausibleInvitedEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(value);
}
