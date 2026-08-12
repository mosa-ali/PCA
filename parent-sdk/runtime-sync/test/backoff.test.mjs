import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBackoff, BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_RETRY_COUNT } from '../dist/backoff.js';

const NOW = 1_700_000_000_000;

test('bounded within [0.5x, 1.0x] of the exponential delay', () => {
  const low = computeBackoff(0, NOW, () => 0);
  const high = computeBackoff(0, NOW, () => 0.999999);
  assert.ok(low.nextRetryAtEpochMillis - NOW >= Math.round(BACKOFF_BASE_MS * 0.5) - 1);
  assert.ok(high.nextRetryAtEpochMillis - NOW <= BACKOFF_BASE_MS);
});

test('caps at BACKOFF_CAP_MS for a large retryCount', () => {
  const decision = computeBackoff(30, NOW, () => 1);
  assert.ok(decision.nextRetryAtEpochMillis - NOW <= BACKOFF_CAP_MS);
});

test('stops retrying at MAX_RETRY_COUNT', () => {
  assert.equal(computeBackoff(MAX_RETRY_COUNT, NOW).shouldRetry, false);
  assert.equal(computeBackoff(MAX_RETRY_COUNT - 1, NOW).shouldRetry, true);
});
