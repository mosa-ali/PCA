import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ENVELOPE_BYTES,
  MAX_OPAQUE_ID_LENGTH,
  isPlausibleOpaqueId,
  isPlausibleEnvelopeCiphertext,
} from '../../dist/recovery/policy.js';

test('isPlausibleOpaqueId: accepts within-bound non-empty strings, rejects empty/oversized/non-string', () => {
  assert.equal(isPlausibleOpaqueId('family-1'), true);
  assert.equal(isPlausibleOpaqueId('a'.repeat(MAX_OPAQUE_ID_LENGTH)), true);
  assert.equal(isPlausibleOpaqueId(''), false);
  assert.equal(isPlausibleOpaqueId('a'.repeat(MAX_OPAQUE_ID_LENGTH + 1)), false);
  assert.equal(isPlausibleOpaqueId(null), false);
  assert.equal(isPlausibleOpaqueId(42), false);
});

test('isPlausibleEnvelopeCiphertext: accepts within-bound Buffers, rejects empty/oversized/non-Buffer', () => {
  assert.equal(isPlausibleEnvelopeCiphertext(Buffer.from('x')), true);
  assert.equal(isPlausibleEnvelopeCiphertext(Buffer.alloc(MAX_ENVELOPE_BYTES)), true);
  assert.equal(isPlausibleEnvelopeCiphertext(Buffer.alloc(0)), false);
  assert.equal(isPlausibleEnvelopeCiphertext(Buffer.alloc(MAX_ENVELOPE_BYTES + 1)), false);
  assert.equal(isPlausibleEnvelopeCiphertext('not a buffer'), false);
  assert.equal(isPlausibleEnvelopeCiphertext(null), false);
});
