import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDeviceClock, advanceHighWaterMark } from '../../dist/tamper/TrustedTimeHighWaterMark.js';

test('first-ever observation (no persisted mark) is never a rollback', () => {
  const result = evaluateDeviceClock(null, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(result.isRollbackDetected, false);
  assert.equal(result.trustedNowUtc.getTime(), new Date('2026-01-01T00:00:00.000Z').getTime());
});

test('a clock reading equal to the high-water mark is not a rollback', () => {
  const mark = new Date('2026-02-01T00:00:00.000Z');
  const result = evaluateDeviceClock(mark, mark);
  assert.equal(result.isRollbackDetected, false);
});

test('a clock reading after the high-water mark advances trusted time normally', () => {
  const mark = new Date('2026-02-01T00:00:00.000Z');
  const later = new Date('2026-02-02T00:00:00.000Z');
  const result = evaluateDeviceClock(mark, later);
  assert.equal(result.isRollbackDetected, false);
  assert.equal(result.trustedNowUtc.getTime(), later.getTime());
});

test('a clock reading BEFORE the high-water mark is detected as rollback, and trusted time is pinned at the mark, not the rolled-back reading', () => {
  const mark = new Date('2026-02-01T00:00:00.000Z');
  const rolledBack = new Date('2026-01-01T00:00:00.000Z');
  const result = evaluateDeviceClock(mark, rolledBack);

  assert.equal(result.isRollbackDetected, true);
  assert.equal(result.trustedNowUtc.getTime(), mark.getTime()); // never regresses to the rolled-back reading
});

test('advanceHighWaterMark never regresses the persisted mark even during an active rollback', () => {
  const mark = new Date('2026-02-01T00:00:00.000Z');
  const rolledBack = new Date('2026-01-01T00:00:00.000Z');
  const evaluation = evaluateDeviceClock(mark, rolledBack);

  const nextMark = advanceHighWaterMark(mark, evaluation);

  assert.equal(nextMark.getTime(), mark.getTime()); // stays put, never regresses
});

test('advanceHighWaterMark moves forward with a genuine later observation', () => {
  const mark = new Date('2026-02-01T00:00:00.000Z');
  const later = new Date('2026-03-01T00:00:00.000Z');
  const evaluation = evaluateDeviceClock(mark, later);

  const nextMark = advanceHighWaterMark(mark, evaluation);

  assert.equal(nextMark.getTime(), later.getTime());
});

test('advanceHighWaterMark from a null persisted mark adopts the first observation', () => {
  const first = new Date('2026-01-01T00:00:00.000Z');
  const evaluation = evaluateDeviceClock(null, first);

  const nextMark = advanceHighWaterMark(null, evaluation);

  assert.equal(nextMark.getTime(), first.getTime());
});
