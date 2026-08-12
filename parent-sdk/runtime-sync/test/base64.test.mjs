import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToBase64, base64ToBytes } from '../dist/base64.js';

test('round-trips arbitrary bytes including 0x00/0xff', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 127]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
});

test('round-trips lengths that are and are not multiples of 3 (padding correctness)', () => {
  for (let length = 0; length <= 10; length += 1) {
    const bytes = new Uint8Array(Array.from({ length }, (_, i) => i));
    assert.deepEqual([...base64ToBytes(bytesToBase64(bytes))], [...bytes]);
  }
});

test('matches Buffer.toString("base64") for cross-check purposes', () => {
  const bytes = new Uint8Array([10, 20, 30, 40, 50]);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});
