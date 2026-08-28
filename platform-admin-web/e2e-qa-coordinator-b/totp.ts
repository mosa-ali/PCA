import { createHmac } from 'node:crypto';

/**
 * Coordinator B (QA/runtime) helper -- mirrors backend/src/platformadmin/auth/totp.ts's
 * RFC 6238 algorithm exactly (HMAC-SHA1, 30s step, 6 digits) so this
 * Playwright suite can compute a live, valid code for each seeded admin's
 * base32 TOTP secret (printed by backend/scripts/seed-local.mjs) without
 * importing backend source directly (Coordinator B does not depend on
 * backend/dist from a frontend package).
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(encoded: string): Buffer {
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
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binaryCode % 10 ** 6).toString().padStart(6, '0');
}

export function computeTotp(secretBase32: string, timeMs: number = Date.now()): string {
  const counter = Math.floor(timeMs / 1000 / 30);
  return hotp(base32Decode(secretBase32), counter);
}

/** Waits until comfortably inside a 30s TOTP window so a code computed right after is not validated a moment after its window rolls over. */
export async function ensureComfortablyInsideTotpWindow(marginMs = 5_000): Promise<void> {
  const msIntoStep = Date.now() % 30_000;
  const msRemaining = 30_000 - msIntoStep;
  if (msRemaining < marginMs) {
    await new Promise((resolve) => setTimeout(resolve, msRemaining + 1_000));
  }
}
