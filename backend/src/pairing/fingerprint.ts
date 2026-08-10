import { createHash } from 'node:crypto';

/**
 * Deterministic, bounded fingerprint of PUBLIC key material for the parent
 * to visually confirm against the child device (doc 08 PCA-FR-141). Uses
 * SHA-256 (a standard, maintained primitive; no custom cryptography) over
 * the exact public-key bytes as submitted, formatted as colon-separated
 * hex octets for readability. Never accepts or touches private key
 * material -- the input is always a public key that was already validated
 * and persisted as such.
 */
export function computeKeyFingerprint(publicKey: string): string {
  const digest = createHash('sha256').update(publicKey, 'utf8').digest('hex');
  return digest.match(/.{1,4}/g)!.join('-');
}
