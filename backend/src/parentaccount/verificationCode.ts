import { randomInt, createHash, timingSafeEqual } from 'node:crypto';

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

export function generateVerificationCode(): GeneratedVerificationCode {
  const value = randomInt(CODE_MIN, CODE_MAX);
  const code = value.toString(10).padStart(CODE_DIGITS, '0');
  return { code, codeHash: hashVerificationCode(code) };
}

export function hashVerificationCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
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
