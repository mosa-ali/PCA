// Self-contained RFC 6238 TOTP generator for the REAL-BACKEND E2E suite
// (e2e/realBackend.spec.ts) only. Deliberately reimplemented here from the
// RFC rather than importing backend/src/platformadmin/auth/totp.ts's
// compiled output: this file lives in platform-admin-web/** (this lane's
// exclusive ownership boundary -- ROUND4_AGENT55_ASSIGNMENT.md, "Only edit
// platform-admin-web/**"), and importing a path outside that boundary
// (backend/dist/... is generated, not committed, and its location is an
// implementation detail of how the backend happens to be built for a given
// test run) would make this spec fragile/non-portable across environments.
// The algorithm itself (HMAC-SHA1, 30s step, 6 digits) is a public,
// unchanging standard, so duplicating it here carries none of the
// "reinventing business logic" risk that duplicating, say, RBAC matrices
// would -- see backend/src/platformadmin/auth/totp.ts's own header for the
// canonical server-side implementation this mirrors.
import { createHmac } from 'node:crypto';

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = binaryCode % 10 ** TOTP_DIGITS;
  return code.toString().padStart(TOTP_DIGITS, '0');
}

/** `stepOffset` lets the caller request a code for a future/past 30s step (e.g. +1 for a second, non-replayed code moments after login used the current step's code -- the real server's ±1 clock-skew tolerance accepts it immediately, no waiting required). */
export function computeTotp(secretBase32: string, stepOffset = 0, timeMs: number = Date.now()): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS) + stepOffset;
  return hotp(secret, counter);
}

/**
 * Milliseconds until the START of the NEXT 30-second TOTP step, plus a
 * small buffer. The real server durably remembers the last-accepted TOTP
 * counter per account (TOTP-REPLAY-1) across the account's entire
 * lifetime, not merely within one test run -- so re-running this spec
 * shortly after a previous run (e.g. while iterating on a locator fix)
 * risks computeTotp(secret, 0) landing on a counter a previous run already
 * claimed, which the real server correctly rejects as a replay. Waiting
 * out to a genuinely fresh window before the one real (non-invalid-code)
 * login in this spec makes that call deterministic regardless of how
 * recently the suite last ran, instead of depending on wall-clock luck.
 */
export function msUntilNextTotpWindow(bufferMs = 1500, timeMs: number = Date.now()): number {
  const stepMs = TOTP_STEP_SECONDS * 1000;
  const remainder = timeMs % stepMs;
  return stepMs - remainder + bufferMs;
}
