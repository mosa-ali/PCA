// FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- derivation + enforcement
// unit tests, including the exact clock-boundary matrix
// WRITER61_ASSIGNMENT.md requires: exactly-at-expiry,
// one-second-before-expiry, one-second-after-expiry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveFreeAccessStatus, assertNewCapacityAllowed, MS_PER_DAY } from '../../../dist/parentaccount/freeaccess/deriveFreeAccessStatus.js';
import { FreeAccessEnforcementError } from '../../../dist/parentaccount/freeaccess/types.js';

const STARTED_AT = new Date('2026-07-01T00:00:00.000Z');

function timeLimitedSnapshot(expiresAt) {
  return { mode: 'TIME_LIMITED', durationDays: 30, startedAt: STARTED_AT, expiresAt, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
}

function perpetualSnapshot() {
  return { mode: 'PERPETUAL', durationDays: null, startedAt: STARTED_AT, expiresAt: null, defaultParentMemberLimit: 4, defaultManagedDeviceLimit: 5 };
}

test('PERPETUAL: status is always PERPETUAL, remainingDays and expiresAt are null, regardless of clock', () => {
  const status = deriveFreeAccessStatus(perpetualSnapshot(), new Date('2099-01-01T00:00:00.000Z'));
  assert.deepEqual(status, {
    mode: 'PERPETUAL',
    grantedAt: STARTED_AT.toISOString(),
    expiresAt: null,
    remainingDays: null,
    status: 'PERPETUAL',
  });
});

test('TIME_LIMITED: 30 days before expiry reports remainingDays=30, status ACTIVE', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(expiresAt.getTime() - 30 * MS_PER_DAY);
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), now);
  assert.equal(status.status, 'ACTIVE');
  assert.equal(status.remainingDays, 30);
  assert.equal(status.expiresAt, expiresAt.toISOString());
});

for (const days of [7, 3, 1]) {
  test(`TIME_LIMITED: ${days} whole days before expiry reports remainingDays=${days}`, () => {
    const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
    const now = new Date(expiresAt.getTime() - days * MS_PER_DAY);
    const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), now);
    assert.equal(status.status, 'ACTIVE');
    assert.equal(status.remainingDays, days);
  });
}

test('TIME_LIMITED: less than 24h before expiry reports remainingDays=0 ("expires today"), still ACTIVE', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(expiresAt.getTime() - 60 * 60 * 1000); // 1 hour before
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), now);
  assert.equal(status.status, 'ACTIVE');
  assert.equal(status.remainingDays, 0);
});

test('CLOCK BOUNDARY: exactly one second before expiry is ACTIVE with remainingDays=0', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const now = new Date(expiresAt.getTime() - 1000);
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), now);
  assert.equal(status.status, 'ACTIVE');
  assert.equal(status.remainingDays, 0);
});

test('CLOCK BOUNDARY: exactly AT the expiry instant is EXPIRED (inclusive boundary, fail closed)', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), new Date(expiresAt.getTime()));
  assert.equal(status.status, 'EXPIRED');
  assert.equal(status.remainingDays, null);
});

test('CLOCK BOUNDARY: exactly one second after expiry is EXPIRED', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), new Date(expiresAt.getTime() + 1000));
  assert.equal(status.status, 'EXPIRED');
  assert.equal(status.remainingDays, null);
});

test('TIME_LIMITED: long after expiry remains EXPIRED, never re-derives to ACTIVE/PERPETUAL', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(expiresAt), new Date('2099-01-01T00:00:00.000Z'));
  assert.equal(status.status, 'EXPIRED');
});

test('defensive: TIME_LIMITED with a null expiresAt (invariant violation) fails closed as EXPIRED, never grants indefinite access', () => {
  const status = deriveFreeAccessStatus(timeLimitedSnapshot(null), new Date('2026-07-02T00:00:00.000Z'));
  assert.equal(status.status, 'EXPIRED');
  assert.equal(status.remainingDays, null);
});

test('client-supplied clock is never trusted: derivation depends only on the `now` argument the SERVER passes, never anything embedded in the snapshot besides its own timestamps', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 30 * MS_PER_DAY);
  const snapshot = timeLimitedSnapshot(expiresAt);
  // Same snapshot, two different server-supplied `now` values -> two
  // different, independently correct answers. There is no field on
  // FreeAccessStatus or FreeAccessSnapshot a client could tamper with to
  // change this.
  const before = deriveFreeAccessStatus(snapshot, new Date(expiresAt.getTime() - MS_PER_DAY));
  const after = deriveFreeAccessStatus(snapshot, new Date(expiresAt.getTime() + MS_PER_DAY));
  assert.equal(before.status, 'ACTIVE');
  assert.equal(after.status, 'EXPIRED');
});

test('assertNewCapacityAllowed: ACTIVE and PERPETUAL never throw', () => {
  assert.doesNotThrow(() => assertNewCapacityAllowed({ status: 'ACTIVE' }, false));
  assert.doesNotThrow(() => assertNewCapacityAllowed({ status: 'PERPETUAL' }, false));
});

test('assertNewCapacityAllowed: EXPIRED without an active complimentary grant throws a typed FreeAccessEnforcementError', () => {
  assert.throws(() => assertNewCapacityAllowed({ status: 'EXPIRED' }, false), (error) => {
    assert.ok(error instanceof FreeAccessEnforcementError);
    assert.equal(error.code, 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
    return true;
  });
});

test('assertNewCapacityAllowed: EXPIRED WITH an active complimentary COMMERCIAL_ACCESS grant never throws (Round5 grant system overrides)', () => {
  assert.doesNotThrow(() => assertNewCapacityAllowed({ status: 'EXPIRED' }, true));
});
