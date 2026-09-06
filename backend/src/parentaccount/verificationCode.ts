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

export class MissingVerificationCodeSecretError extends Error {
  constructor() {
    super(
      'PCA_VERIFICATION_CODE_HMAC_SECRET must be set in production. Refusing to hash/verify ' +
        'verification codes with a guessable or absent key.',
    );
    this.name = 'MissingVerificationCodeSecretError';
  }
}

function resolveVerificationCodeHmacSecret(env: NodeJS.ProcessEnv): string {
  const configured = env.PCA_VERIFICATION_CODE_HMAC_SECRET;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  if (isProductionSensitiveRuntime(env)) throw new MissingVerificationCodeSecretError();
  return DEV_ONLY_DEFAULT_HMAC_SECRET;
}

export function generateVerificationCode(env: NodeJS.ProcessEnv = process.env): GeneratedVerificationCode {
  const value = randomInt(CODE_MIN, CODE_MAX);
  const code = value.toString(10).padStart(CODE_DIGITS, '0');
  return { code, codeHash: hashVerificationCode(code, env) };
}

export function hashVerificationCode(code: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = resolveVerificationCodeHmacSecret(env);
  return createHmac('sha256', secret).update(code, 'utf8').digest('hex');
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
