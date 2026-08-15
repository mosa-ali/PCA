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
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 64;
const CREDENTIAL_PREFIX = 'scrypt';

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

/** Never throws; returns false for a malformed/corrupt encoded credential -- callers must still respond with the single generic failure regardless of which branch produced false. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== CREDENTIAL_PREFIX) return false;
  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n <= 0 || r <= 0 || p <= 0) return false;
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
