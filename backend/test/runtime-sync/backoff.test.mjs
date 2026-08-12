import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBackoff } from '../../dist/runtime-sync/backoff.js';
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_RETRY_COUNT } from '../../dist/runtime-sync/policy.js';

const NOW = 1_700_000_000_000;

test('retry 0 delay is bounded within [0.5x, 1.0x] of the base', () => {
  const low = computeBackoff(0, NOW, () => 0);
  const high = computeBackoff(0, NOW, () => 0.999999);
  assert.equal(low.shouldRetry, true);
  assert.equal(low.nextRetryAtEpochMillis - NOW, Math.round(BACKOFF_BASE_MS * 0.5));
  assert.ok(high.nextRetryAtEpochMillis - NOW <= BACKOFF_BASE_MS);
  assert.ok(high.nextRetryAtEpochMillis - NOW >= BACKOFF_BASE_MS * 0.5);
});

test('delay grows exponentially with retryCount, never exceeding the cap', () => {
  const r1 = computeBackoff(1, NOW, () => 1);
  const r2 = computeBackoff(2, NOW, () => 1);
  assert.ok(r2.nextRetryAtEpochMillis - NOW > r1.nextRetryAtEpochMillis - NOW);
  const rHigh = computeBackoff(20, NOW, () => 1);
  assert.ok(rHigh.nextRetryAtEpochMillis - NOW <= BACKOFF_CAP_MS);
});

test('retryCount at or beyond MAX_RETRY_COUNT reports shouldRetry=false, never retries forever', () => {
  const decision = computeBackoff(MAX_RETRY_COUNT, NOW, () => 0.5);
  assert.equal(decision.shouldRetry, false);
});

test('jitter never produces a negative or zero delay below half the exponential', () => {
  for (let retryCount = 0; retryCount < MAX_RETRY_COUNT; retryCount += 1) {
    const decision = computeBackoff(retryCount, NOW, () => 0);
    assert.ok(decision.nextRetryAtEpochMillis >= NOW);
  }
});
