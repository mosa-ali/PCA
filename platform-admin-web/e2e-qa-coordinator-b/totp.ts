import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Coordinator B (QA/runtime) helper -- mirrors backend/src/platformadmin/auth/totp.ts's
 * RFC 6238 algorithm exactly (HMAC-SHA1, 30s step, 6 digits) so this
 * Playwright suite can compute a live, valid code for each seeded admin's
 * base32 TOTP secret (printed by backend/scripts/seed-local.mjs) without
 * importing backend source directly.
 *
 * The backend's TOTP-REPLAY-1 counter-claim is real and correct (see
 * PlatformAdminAuthService.login): the SAME 30-second window can never be
 * claimed twice for the same admin, even across unrelated logins. Playwright
 * spawns a FRESH worker process per test even with workers:1/fullyParallel:
 * false, so an in-memory "last window used" guard would not survive between
 * tests. A small on-disk lock file (this session's scratch temp dir) makes
 * the guard survive process boundaries: computeUniqueTotp claims a window
 * for a given secret exactly once, blocking (real wall-clock wait) for the
 * next window if the current one is already claimed.
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

/**
 * Waits until comfortably inside a 30s TOTP window so a code computed right
 * after is not validated a moment after its window rolls over. Default
 * margin is generous (not just "code computation time") because the real
 * risk window is EVERYTHING between computing the code and the server
 * receiving it -- filling the email/password/TOTP fields and clicking
 * submit in a real (occasionally loaded) browser, observed to occasionally
 * exceed a 5s margin and land the submission one window late.
 */
export async function ensureComfortablyInsideTotpWindow(marginMs = 15_000): Promise<void> {
  const msIntoStep = Date.now() % 30_000;
  const msRemaining = 30_000 - msIntoStep;
  if (msRemaining < marginMs) {
    await new Promise((resolve) => setTimeout(resolve, msRemaining + 1_000));
  }
}

const LOCK_DIR = join(tmpdir(), 'pca-qa-coordinator-b');
const LOCK_FILE = join(LOCK_DIR, 'totp-window-claims.json');

function readClaims(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeClaims(claims: Record<string, number>): void {
  if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });
  writeFileSync(LOCK_FILE, JSON.stringify(claims), 'utf8');
}

/**
 * Claims a TOTP window for `label` (e.g. the admin's email) exactly once,
 * across however many separate Playwright worker processes this suite
 * spawns. If the current window was already claimed for this label, waits
 * (real wall-clock time) for the next window before returning a code for
 * it -- guarantees the backend's real TOTP-REPLAY-1 counter-claim never
 * legitimately rejects a login this suite intended to succeed.
 */
export async function computeUniqueTotp(secretBase32: string, label: string): Promise<string> {
  await ensureComfortablyInsideTotpWindow();
  for (;;) {
    const now = Date.now();
    const counter = Math.floor(now / 1000 / 30);
    const claims = readClaims();
    if (claims[label] !== counter) {
      claims[label] = counter;
      writeClaims(claims);
      return hotp(base32Decode(secretBase32), counter);
    }
    // This window is already claimed for this label -- wait for the next one.
    const msIntoStep = now % 30_000;
    await new Promise((resolve) => setTimeout(resolve, 30_000 - msIntoStep + 500));
  }
}
