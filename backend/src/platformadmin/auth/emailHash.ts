import { createHash } from 'node:crypto';

/**
 * SHA-256 of the normalized-lowercase operator email -- the ONLY form an
 * email address is ever hashed into for platform_admin_accounts.email_hash
 * / platform_admin_login_attempts.email_hash lookups. Never stored or
 * logged as raw plaintext anywhere in this domain.
 */
export function hashAdminEmail(email: string): Buffer {
  const normalized = email.trim().toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest();
}
