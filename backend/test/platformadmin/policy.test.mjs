import assert from 'node:assert/strict';
import test from 'node:test';
import { isLockedOut, PLATFORM_ADMIN_LOCKOUT_THRESHOLD, PLATFORM_ADMIN_LOCKOUT_WINDOW_MS, computeExpiry } from '../../dist/platformadmin/auth/policy.js';

function minutesAgo(now, minutes) {
  return new Date(now.getTime() - minutes * 60_000);
}

test('fewer than the lockout threshold never locks out', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const failures = Array.from({ length: PLATFORM_ADMIN_LOCKOUT_THRESHOLD - 1 }, (_, i) => minutesAgo(now, i));
  assert.equal(isLockedOut(failures, now), false);
});

test('exactly the threshold, all within the window, locks out', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const failures = Array.from({ length: PLATFORM_ADMIN_LOCKOUT_THRESHOLD }, (_, i) => minutesAgo(now, i));
  assert.equal(isLockedOut(failures, now), true);
});

test('a 6th failure beyond the threshold is still locked out with the correct password (the caller must still refuse)', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const failures = Array.from({ length: PLATFORM_ADMIN_LOCKOUT_THRESHOLD + 1 }, (_, i) => minutesAgo(now, i));
  assert.equal(isLockedOut(failures, now), true);
});

test('lockout clears once the window rolls past the threshold-th most recent failure', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const windowMinutes = PLATFORM_ADMIN_LOCKOUT_WINDOW_MS / 60_000;
  // 5 failures, all older than the window.
  const failures = Array.from({ length: PLATFORM_ADMIN_LOCKOUT_THRESHOLD }, (_, i) => minutesAgo(now, windowMinutes + 1 + i));
  assert.equal(isLockedOut(failures, now), false);
});

test('computeExpiry adds the TTL to the issued instant', () => {
  const issuedAt = new Date('2026-01-01T00:00:00.000Z');
  const expiry = computeExpiry(issuedAt, 60_000);
  assert.equal(expiry.getTime() - issuedAt.getTime(), 60_000);
});
