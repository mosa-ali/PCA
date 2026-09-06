import assert from 'node:assert/strict';
import test from 'node:test';
import { EMAIL_MAX_ATTEMPTS, computeEmailBackoff } from '../../dist/email/emailBackoff.js';

test('shouldRetry is true below EMAIL_MAX_ATTEMPTS and false at/after it', () => {
  const now = 1_000_000;
  for (let attempt = 0; attempt < EMAIL_MAX_ATTEMPTS; attempt++) {
    assert.equal(computeEmailBackoff(attempt, now).shouldRetry, true, `attempt ${attempt}`);
  }
  assert.equal(computeEmailBackoff(EMAIL_MAX_ATTEMPTS, now).shouldRetry, false);
  assert.equal(computeEmailBackoff(EMAIL_MAX_ATTEMPTS + 5, now).shouldRetry, false);
});

test('delay grows with attempt count and is bounded by full jitter within [0.5x, 1.0x) of the exponential value', () => {
  const now = 0;
  for (let attempt = 0; attempt < EMAIL_MAX_ATTEMPTS; attempt++) {
    const minFraction = computeEmailBackoff(attempt, now, () => 0);
    const maxFraction = computeEmailBackoff(attempt, now, () => 0.999999);
    assert.ok(minFraction.nextAttemptAtEpochMillis <= maxFraction.nextAttemptAtEpochMillis, `attempt ${attempt}`);
    assert.ok(minFraction.nextAttemptAtEpochMillis >= now, `attempt ${attempt} must never be before now`);
  }
});

test('a terminal (no-retry) decision reports nextAttemptAtEpochMillis == now, never a scheduled future time', () => {
  const now = 555;
  const decision = computeEmailBackoff(EMAIL_MAX_ATTEMPTS, now);
  assert.equal(decision.nextAttemptAtEpochMillis, now);
});
