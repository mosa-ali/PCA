import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAdjustedSnapshot, FreeAccessAdjustmentError } from '../../../dist/parentaccount/freeaccess/adjustment.js';
import { MS_PER_DAY } from '../../../dist/parentaccount/freeaccess/deriveFreeAccessStatus.js';

const STARTED_AT = new Date('2026-07-01T00:00:00.000Z');

function timeLimited(expiresAt) {
  return { mode: 'TIME_LIMITED', durationDays: 30, startedAt: STARTED_AT, expiresAt, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
}
function perpetual() {
  return { mode: 'PERPETUAL', durationDays: null, startedAt: STARTED_AT, expiresAt: null, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
}

test('EXTEND: adds days from the current expiry when still ACTIVE', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(STARTED_AT.getTime() + 5 * MS_PER_DAY);
  const after = computeAdjustedSnapshot(timeLimited(expiresAt), { kind: 'EXTEND', additionalDays: 10 }, now);
  assert.equal(after.expiresAt.getTime(), expiresAt.getTime() + 10 * MS_PER_DAY);
  assert.equal(after.mode, 'TIME_LIMITED');
  assert.equal(after.defaultParentMemberLimit, 4, 'adjustment never touches default limits');
});

test('EXTEND: on an already-EXPIRED account, extends from NOW rather than the stale past expiry', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(expiresAt.getTime() + 100 * MS_PER_DAY); // long expired
  const after = computeAdjustedSnapshot(timeLimited(expiresAt), { kind: 'EXTEND', additionalDays: 10 }, now);
  assert.equal(after.expiresAt.getTime(), now.getTime() + 10 * MS_PER_DAY);
});

test('EXTEND: rejects a PERPETUAL account (wrong action for mode)', () => {
  assert.throws(() => computeAdjustedSnapshot(perpetual(), { kind: 'EXTEND', additionalDays: 10 }, STARTED_AT), (e) => e instanceof FreeAccessAdjustmentError && e.code === 'INVALID_ACTION_FOR_MODE');
});

test('EXTEND: rejects non-positive/non-integer days', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  for (const bad of [0, -5, 1.5, 'ten', null, undefined]) {
    assert.throws(() => computeAdjustedSnapshot(timeLimited(expiresAt), { kind: 'EXTEND', additionalDays: bad }, STARTED_AT));
  }
});

test('REDUCE: subtracts days from current expiry, can produce an already-expired result', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(STARTED_AT.getTime() + 5 * MS_PER_DAY);
  const after = computeAdjustedSnapshot(timeLimited(expiresAt), { kind: 'REDUCE', reduceDays: 29 }, now);
  assert.ok(after.expiresAt.getTime() < now.getTime(), 'a large REDUCE can immediately expire the account -- explicit admin power, not a bug');
});

test('REDUCE: rejects a PERPETUAL account', () => {
  assert.throws(() => computeAdjustedSnapshot(perpetual(), { kind: 'REDUCE', reduceDays: 5 }, STARTED_AT), (e) => e instanceof FreeAccessAdjustmentError && e.code === 'INVALID_ACTION_FOR_MODE');
});

test('CONVERT_TO_PERPETUAL: from TIME_LIMITED clears duration/expiry, sets mode PERPETUAL', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const after = computeAdjustedSnapshot(timeLimited(expiresAt), { kind: 'CONVERT_TO_PERPETUAL' }, STARTED_AT);
  assert.equal(after.mode, 'PERPETUAL');
  assert.equal(after.durationDays, null);
  assert.equal(after.expiresAt, null);
});

test('CONVERT_TO_PERPETUAL: idempotent from an already-PERPETUAL account', () => {
  const after = computeAdjustedSnapshot(perpetual(), { kind: 'CONVERT_TO_PERPETUAL' }, STARTED_AT);
  assert.equal(after.mode, 'PERPETUAL');
});

test('CONVERT_TO_TIME_LIMITED: from PERPETUAL restarts the clock from NOW', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const after = computeAdjustedSnapshot(perpetual(), { kind: 'CONVERT_TO_TIME_LIMITED', durationDays: 14 }, now);
  assert.equal(after.mode, 'TIME_LIMITED');
  assert.equal(after.durationDays, 14);
  assert.equal(after.expiresAt.getTime(), now.getTime() + 14 * MS_PER_DAY);
});

test('CONVERT_TO_TIME_LIMITED: rejects non-positive/non-integer durationDays', () => {
  for (const bad of [0, -1, 2.5]) {
    assert.throws(() => computeAdjustedSnapshot(perpetual(), { kind: 'CONVERT_TO_TIME_LIMITED', durationDays: bad }, STARTED_AT));
  }
});

test('an adjustment action can never exceed the sane upper bound (guards against a fat-fingered admin value overflowing a Date)', () => {
  assert.throws(() => computeAdjustedSnapshot(perpetual(), { kind: 'CONVERT_TO_TIME_LIMITED', durationDays: 999999 }, STARTED_AT));
});

test('computeAdjustedSnapshot never mutates its `current` input', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const current = timeLimited(expiresAt);
  const snapshotBefore = JSON.stringify(current);
  computeAdjustedSnapshot(current, { kind: 'CONVERT_TO_PERPETUAL' }, STARTED_AT);
  assert.equal(JSON.stringify(current), snapshotBefore);
});
