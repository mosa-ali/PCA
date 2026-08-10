import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RELAY_TTL_MS,
  MAX_RELAY_TTL_MS,
  MAX_CIPHERTEXT_BYTES,
  MAX_OPAQUE_ID_LENGTH,
  resolveRelayTtlMs,
  isPlausibleOpaqueId,
  isPlausibleCiphertext,
} from '../../dist/relay/policy.js';

test('resolveRelayTtlMs: missing input falls back to default', () => {
  assert.equal(resolveRelayTtlMs(undefined), DEFAULT_RELAY_TTL_MS);
});

test('resolveRelayTtlMs: exactly the maximum is accepted', () => {
  assert.equal(resolveRelayTtlMs(MAX_RELAY_TTL_MS), MAX_RELAY_TTL_MS);
});

test('resolveRelayTtlMs: one millisecond above the maximum is rejected', () => {
  assert.throws(() => resolveRelayTtlMs(MAX_RELAY_TTL_MS + 1), RangeError);
});

test('resolveRelayTtlMs: zero, negative, non-finite are rejected', () => {
  assert.throws(() => resolveRelayTtlMs(0), RangeError);
  assert.throws(() => resolveRelayTtlMs(-1), RangeError);
  assert.throws(() => resolveRelayTtlMs(Number.NaN), RangeError);
  assert.throws(() => resolveRelayTtlMs(Number.POSITIVE_INFINITY), RangeError);
});

test('resolveRelayTtlMs: astronomically large value cannot bypass the maximum (overflow guard)', () => {
  assert.throws(() => resolveRelayTtlMs(Number.MAX_SAFE_INTEGER), RangeError);
});

test('isPlausibleOpaqueId: accepts non-empty strings within the bound, rejects empty/oversized/non-string', () => {
  assert.equal(isPlausibleOpaqueId('device-1'), true);
  assert.equal(isPlausibleOpaqueId('a'.repeat(MAX_OPAQUE_ID_LENGTH)), true);
  assert.equal(isPlausibleOpaqueId(''), false);
  assert.equal(isPlausibleOpaqueId('a'.repeat(MAX_OPAQUE_ID_LENGTH + 1)), false);
  assert.equal(isPlausibleOpaqueId(null), false);
  assert.equal(isPlausibleOpaqueId(undefined), false);
  assert.equal(isPlausibleOpaqueId(123), false);
});

test('isPlausibleCiphertext: accepts Buffers within bounds, rejects empty/oversized/non-Buffer', () => {
  assert.equal(isPlausibleCiphertext(Buffer.from('x')), true);
  assert.equal(isPlausibleCiphertext(Buffer.alloc(MAX_CIPHERTEXT_BYTES)), true);
  assert.equal(isPlausibleCiphertext(Buffer.alloc(0)), false);
  assert.equal(isPlausibleCiphertext(Buffer.alloc(MAX_CIPHERTEXT_BYTES + 1)), false);
  assert.equal(isPlausibleCiphertext('not a buffer'), false);
  assert.equal(isPlausibleCiphertext(null), false);
});
