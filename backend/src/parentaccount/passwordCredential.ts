import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Independently implemented from platformadmin/auth/passwordCredential.ts
 * ("Platform Administration's passwordCredential.ts pattern is the
 * precedent, adapted, not shared" -- PCA_IMPL_DECISION_003). Same scrypt
 * cost parameters and self-describing encoded format
 * (`scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`), deliberately duplicated
 * rather than imported so this credential domain has zero source
 * dependency on backend/src/platformadmin/** (PCA-ADD-IDENT-001).
 */
// PCA-DW-W2-15E: raised from 2^15 to 2^17 (measured ~205ms -> ~425ms on the
// authoring host, node:crypto scrypt) -- still comfortably fast for a
// single login/registration request, and the format above is already
// self-describing (N/r/p are read back out of the encoded credential by
// verifyPassword), so this needs no migration: existing credentials hashed
// at the old cost keep verifying correctly under their own stored N.
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 64;
const CREDENTIAL_PREFIX = 'scrypt';

// PCA-DW-W2-R1-12: verifyPassword reads N/r/p back out of the (untrusted)
// stored credential string -- a corrupt or hostile row could otherwise ask
// scrypt for unreasonable CPU/memory before returning false. Bounding them
// to the current legitimate maximums (never lower than SCRYPT_N/R/P, so
// this rises automatically alongside any future cost bump and never
// rejects a real credential) caps the worst case at exactly what a
// legitimate verification already costs.
const MAX_SCRYPT_N = SCRYPT_N;
const MAX_SCRYPT_R = SCRYPT_R;
const MAX_SCRYPT_P = SCRYPT_P;

function requiredMaxMem(n: number, r: number): number {
  return 128 * n * r * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scrypt(password, salt, DERIVED_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: requiredMaxMem(SCRYPT_N, SCRYPT_R),
  });
  return [CREDENTIAL_PREFIX, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), derivedKey.toString('hex')].join('$');
}

/**
 * A fixed, never-matching scrypt-shaped credential used ONLY to equalise the
 * computational cost of login()'s "unknown/unverified account" branch with its
 * "wrong password" branch, so response timing does not reveal whether an email
 * address has a live parent account (account-existence timing oracle).
 *
 * P1-09 (PCA full read-only assessment, 2026-09-21): this was previously a
 * hand-written literal encoding N=32768 while real credentials are hashed at
 * SCRYPT_N=131072, so the branch it existed to equalise actually cost ~4x LESS
 * -- silently re-opening the exact oracle the surrounding code claims to close.
 *
 * It is now derived from the live SCRYPT_* constants instead of being hashed
 * from a sentinel, which makes that class of drift impossible and costs nothing
 * at boot. Deriving the *encoded parameters* is sufficient: verifyPassword
 * derives its work factor from the encoded N/r/p, so an equal encoded cost
 * yields an equal verification cost. The all-zero salt/key can never be a real
 * credential's hash, and the calling branch has already established that no
 * account exists, so a (astronomically improbable) match would still be
 * rejected.
 *
 * test/parentaccount/passwordCredential.test.mjs asserts the encoded cost
 * parameters here always equal those of a freshly hashed real credential.
 */
export const DUMMY_PASSWORD_HASH: string = [
  CREDENTIAL_PREFIX,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  '00'.repeat(SALT_BYTES),
  '00'.repeat(DERIVED_KEY_BYTES),
].join('$');

/** Never throws; returns false for a malformed/corrupt encoded credential -- callers must still respond with the single generic failure regardless of which branch produced false. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== CREDENTIAL_PREFIX) return false;
  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) return false;
  if (n > MAX_SCRYPT_N || r > MAX_SCRYPT_R || p > MAX_SCRYPT_P) return false;
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  let derivedKey: Buffer;
  try {
    derivedKey = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: requiredMaxMem(n, r) });
  } catch {
    return false;
  }
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;

/** Server-side password shape validation -- never trusts a client-side-only strength check. */
export function isPlausiblePassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;
}
