import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt cost parameters. r=8, p=1.
 *
 * N raised 2^15 -> 2^17 on 2026-09-21 for parity with the parent-account
 * plane. Platform Administration is the MORE privileged realm (APP_OWNER can
 * suspend families, read the audit trail, and operate billing), yet its
 * credentials previously cost ~4x LESS to attack offline than an ordinary
 * parent's -- a privilege/work-factor inversion. The encoding is
 * self-describing (`scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`), so credentials
 * hashed at the old cost keep verifying correctly under their own stored N;
 * no migration is required or performed.
 */
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 64;
const CREDENTIAL_PREFIX = 'scrypt';

/** Non-login credential used while first-owner activation is pending. */
export const PENDING_ACTIVATION_CREDENTIAL = 'PCA_PENDING_FIRST_OWNER_ACTIVATION';

/**
 * PCA-ADMIN-TIMING-1. A fixed, never-matching scrypt-shaped credential used
 * only to equalise login()'s "unknown email / non-ACTIVE account" branch cost
 * with its "known account, wrong password" branch, so timing does not reveal
 * account existence.
 *
 * PCA full assessment P1-09 (2026-09-21) found the *parent* plane's equivalent
 * literal had drifted out of sync with its own SCRYPT_N (encoded 2^15 while
 * real credentials used 2^17), silently re-opening the oracle. This plane is
 * currently self-consistent, but the same hand-written-literal pattern is
 * drift-prone by construction, so it is derived from the live SCRYPT_*
 * constants here too. Deriving the encoded parameters is sufficient:
 * verifyPassword takes its work factor from the encoded N/r/p.
 *
 * test/platformadmin/passwordCredential.test.mjs asserts these encoded cost
 * parameters always equal those of a freshly hashed real credential.
 */
export const DUMMY_PASSWORD_CREDENTIAL: string = [
  CREDENTIAL_PREFIX,
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  '00'.repeat(SALT_BYTES),
  '00'.repeat(DERIVED_KEY_BYTES),
].join('$');

// scrypt's default maxmem (32 MiB) is below what the configured cost implies
// (128 * N * r bytes), so it is always passed explicitly with generous
// headroom -- a slightly different libuv/OpenSSL accounting must never
// spuriously reject the configured cost parameters.
function requiredMaxMem(n: number, r: number): number {
  return 128 * n * r * 2;
}

// PCA-ADMIN-PWD-1 (2026-09-21): mirrors the parent plane's PCA-DW-W2-R1-12
// hardening, which this plane was missing. verifyPassword reads N/r/p back out
// of the (untrusted) stored credential string; without a ceiling, a corrupt or
// hostile row could ask scrypt for unreasonable CPU/memory before returning
// false -- turning operator login into a denial-of-service primitive. Bounding
// them to the current legitimate maximums never rejects a real credential and
// rises automatically alongside any future cost bump.
const MAX_SCRYPT_N = SCRYPT_N;
const MAX_SCRYPT_R = SCRYPT_R;
const MAX_SCRYPT_P = SCRYPT_P;

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
 * Verifies a candidate password against an encoded credential string.
 * Returns false (never throws) for a malformed/corrupt encoded credential
 * -- this is a defensive, non-oracle-generating fallback; callers
 * (PlatformAdminAuthService.login) must still respond with the single
 * generic UNAUTHORIZED error regardless of which branch produced false.
 */
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
