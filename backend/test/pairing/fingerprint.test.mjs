import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { computeKeyFingerprint } from '../../dist/pairing/fingerprint.js';

function key() {
  return randomBytes(32).toString('base64url');
}

test('same key produces a stable fingerprint across repeated calls', () => {
  const k = key();
  assert.equal(computeKeyFingerprint(k), computeKeyFingerprint(k));
});

test('changing the DSK/DEK bytes changes its fingerprint', () => {
  const a = key();
  const b = key();
  assert.notEqual(computeKeyFingerprint(a), computeKeyFingerprint(b));
});

test('DSK and DEK cannot be swapped without detection: different keys never collide', () => {
  const dsk = key();
  const dek = key();
  const dskFingerprint = computeKeyFingerprint(dsk);
  const dekFingerprint = computeKeyFingerprint(dek);
  assert.notEqual(dskFingerprint, dekFingerprint);
});

test('fingerprint is a bounded, readable representation, not the raw key', () => {
  const k = key();
  const fingerprint = computeKeyFingerprint(k);
  assert.equal(fingerprint.includes(k), false);
  assert.ok(fingerprint.length > 0 && fingerprint.length < 200);
  assert.match(fingerprint, /^[0-9a-f-]+$/);
});
