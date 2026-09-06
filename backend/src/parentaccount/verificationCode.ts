import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { isProductionSensitiveRuntime } from '../runtime/environment.js';

/**
 * A single-use, cryptographically random 6-digit numeric verification code
 * (PCA-ADD-IDENT-005). Numeric (not a token-shaped string) deliberately --
 * this is meant to be typed by a human reading their email, not
 * copy-pasted like an invitation/session token.
 */
const CODE_DIGITS = 6;
const CODE_MIN = 0;
const CODE_MAX = 10 ** CODE_DIGITS; // exclusive upper bound for randomInt

export interface GeneratedVerificationCode {
  code: string;
  codeHash: string;
}

/**
 * PCA-DW-W2-15B. A 6-digit code has only 1,000,000 possible values -- a
 * plain unkeyed digest (the previous `sha256(code)`) lets anyone who reads
 * the `code_hash` column (a DB leak, a backup, a misdirected replica)
 * brute-force every stored code offline in a fraction of a second, with no
 * dependence on the rate limiting that protects the LIVE verify endpoint.
 * Keying the hash with a server-side secret (HMAC-SHA256) removes that:
 * the attacker also needs the secret, which never lives in the database or
 * in git.
 *
 * Mirrors billing/provider/sandboxProvider.ts's env-gated-secret shape:
 * override via PCA_VERIFICATION_CODE_HMAC_SECRET; a fixed, clearly-labeled
 * dev-only secret is used only when isProductionSensitiveRuntime() is
 * false; production with no configured secret FAILS CLOSED (throws) rather
 * than silently falling back to a guessable default.
 */
const DEV_ONLY_DEFAULT_HMAC_SECRET = 'dev-only-code-hmac-secret-do-not-use-in-production';
const MIN_PRODUCTION_SECRET_BYTES = 32;
const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

export class MissingVerificationCodeSecretError extends Error {
  constructor() {
    super(
      'PCA_VERIFICATION_CODE_HMAC_SECRET must be set in production. Refusing to hash/verify ' +
        'verification codes with a guessable or absent key.',
    );
    this.name = 'MissingVerificationCodeSecretError';
  }
}

/**
 * PCA-DW-W2-R1-9. A short or low-entropy secret defeats the point of keying
 * the code hash (PCA-DW-W2-15B above): an attacker who can guess/brute-force
 * the key regains the same offline code-enumeration attack the keyed
 * construction exists to prevent. Production requires a genuinely random
 * key: base64-encoded, decoding to at least 32 bytes (e.g.
 * `openssl rand -base64 32`).
 */
export class WeakVerificationCodeSecretError extends Error {
  constructor() {
    super(
      `PCA_VERIFICATION_CODE_HMAC_SECRET does not meet the production strength bar: it must be ` +
        `base64-encoded and decode to at least ${MIN_PRODUCTION_SECRET_BYTES} bytes (e.g. via ` +
        `\`openssl rand -base64 32\`). Refusing to hash/verify verification codes with a weak key.`,
    );
    this.name = 'WeakVerificationCodeSecretError';
  }
}

function decodeStrongSecretBytes(configured: string): Buffer | null {
  const trimmed = configured.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64_SHAPE.test(trimmed)) return null;
  return Buffer.from(trimmed, 'base64');
}

function resolveVerificationCodeHmacKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = env.PCA_VERIFICATION_CODE_HMAC_SECRET;
  if (!isProductionSensitiveRuntime(env)) {
    if (typeof configured === 'string' && configured.length > 0) return Buffer.from(configured, 'utf8');
    return Buffer.from(DEV_ONLY_DEFAULT_HMAC_SECRET, 'utf8');
  }
  if (typeof configured !== 'string' || configured.length === 0) throw new MissingVerificationCodeSecretError();
  const decoded = decodeStrongSecretBytes(configured);
  if (!decoded || decoded.length < MIN_PRODUCTION_SECRET_BYTES) throw new WeakVerificationCodeSecretError();
  return decoded;
}

export function generateVerificationCode(env: NodeJS.ProcessEnv = process.env): GeneratedVerificationCode {
  const value = randomInt(CODE_MIN, CODE_MAX);
  const code = value.toString(10).padStart(CODE_DIGITS, '0');
  return { code, codeHash: hashVerificationCode(code, env) };
}

export function hashVerificationCode(code: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = resolveVerificationCodeHmacKey(env);
  return createHmac('sha256', key).update(code, 'utf8').digest('hex');
}

const CODE_SHAPE = new RegExp(`^\\d{${CODE_DIGITS}}$`);

export function isPlausibleVerificationCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_SHAPE.test(value);
}

/** Constant-time comparison of two equal-length hex digest strings -- avoids a timing oracle on code guessing beyond what rate-limiting already bounds. */
export function verificationCodeHashesMatch(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
