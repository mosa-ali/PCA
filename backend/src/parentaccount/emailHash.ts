import { createHash } from 'node:crypto';

/**
 * SHA-256 of the normalized-lowercase parent email -- the ONLY form an
 * email address is ever hashed into for parent_accounts.email_hash lookups
 * (PCA-ADD-IDENT-003). Independently implemented from
 * platformadmin/auth/emailHash.ts's hashAdminEmail ("adapted, not shared"
 * per PCA_IMPL_DECISION_003 -- no shared table, no shared code path between
 * the two identity domains) even though the pattern is intentionally
 * identical. Never stored or logged as raw plaintext anywhere in this
 * domain.
 */
export function hashParentEmail(email: string): Buffer {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 4.5.3.1.3

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(value);
}
