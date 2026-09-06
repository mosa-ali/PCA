/**
 * PCA-DW-W2-R1-4 -- keyed, domain-separated derivation of
 * email_outbox.idempotency_key.
 *
 * WHY THIS EXISTS: the original implementation computed
 * `sha256(kind + ':' + email + ':' + code)` -- an UNKEYED digest. A 6-digit
 * code has only 1,000,000 possible values, so anyone who reads that column
 * (a DB leak, a backup) and already knows or guesses the recipient email
 * (frequently true -- it is often the attacker's own target account) can
 * brute-force all 1,000,000 candidates offline and recover the exact code
 * from the idempotency_key alone, entirely bypassing verificationCode.ts's
 * own HMAC keying of the SEPARATE code_hash column this domain also
 * stores. A dedup key must not become a second, weaker copy of the secret
 * the primary hash was keyed specifically to protect.
 *
 * Fix: HMAC-SHA256 keyed by a key derived via HKDF (RFC 5869) from the
 * outbox encryption key, with an explicit "info" context
 * (HKDF_INFO below) that domain-separates it from that key's own direct
 * use (AES-256-GCM encryption) and from verificationCode.ts's entirely
 * separate PCA_VERIFICATION_CODE_HMAC_SECRET. This reuses one already-
 * required-to-be-high-entropy production secret (fail-closed key
 * resolution already lives in emailOutboxEncryption.ts) rather than
 * provisioning and rotating a second one for a purpose this narrow.
 *
 * Fails closed exactly as encryptOutboxContent/decryptOutboxContent do
 * (resolveOutboxEncryptionKeyBytes throws in production with no configured
 * key) -- there is no separate failure mode to reason about here.
 */

import { createHmac, hkdfSync } from 'node:crypto';
import { resolveOutboxEncryptionKeyBytes } from './emailOutboxEncryption.js';

const HKDF_INFO = Buffer.from('PCA-EMAIL-IDEMPOTENCY-KEY-v1', 'utf8');
const DERIVED_KEY_BYTES = 32;

function deriveIdempotencyHmacKey(env: NodeJS.ProcessEnv): Buffer {
  const rootKey = resolveOutboxEncryptionKeyBytes(env);
  // Zero-length salt is a deliberate, standard HKDF choice here: the input
  // keying material (the outbox encryption key) is already a uniformly
  // random 32-byte value, not low-entropy operator-supplied material that
  // would benefit from a salt's extra randomness at the extract step.
  return Buffer.from(hkdfSync('sha256', rootKey, Buffer.alloc(0), HKDF_INFO, DERIVED_KEY_BYTES));
}

/**
 * `kind`/`normalizedEmail`/`code` are combined as one HMAC message, exactly
 * as the previous unkeyed version did -- the KEY is what changed. Without
 * the derived key (i.e. without the production PCA_EMAIL_OUTBOX_ENCRYPTION_KEY
 * secret), an attacker holding only a stored idempotency_key value plus a
 * known/guessed recipient email cannot verify any of the 1,000,000
 * candidate codes against it offline.
 */
export function computeEmailIdempotencyKey(
  kind: string,
  normalizedEmail: string,
  code: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = deriveIdempotencyHmacKey(env);
  return createHmac('sha256', key).update(`${kind}:${normalizedEmail}:${code}`, 'utf8').digest('hex');
}
