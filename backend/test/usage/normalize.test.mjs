import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUsageObservations, sumSessionDurationMs } from '../../dist/usage/normalize.js';

function raw(overrides = {}) {
  return {
    appToken: 'app-a',
    source: 'ANDROID_USAGE_STATS',
    startAtMonotonicMs: 0,
    endAtMonotonicMs: 1000,
    startAtWallClock: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

test('merges overlapping observations for the same app into one session', () => {
  const { sessions } = normalizeUsageObservations([
    raw({ startAtMonotonicMs: 0, endAtMonotonicMs: 1000 }),
    raw({ startAtMonotonicMs: 500, endAtMonotonicMs: 2000 }),
  ]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].startAtMonotonicMs, 0);
  assert.equal(sessions[0].endAtMonotonicMs, 2000);
});

test('keeps disjoint observations as separate sessions', () => {
  const { sessions } = normalizeUsageObservations([
    raw({ startAtMonotonicMs: 0, endAtMonotonicMs: 1000 }),
    raw({ startAtMonotonicMs: 5000, endAtMonotonicMs: 6000 }),
  ]);
  assert.equal(sessions.length, 2);
});

test('preserves a coverage gap instead of inventing an end time', () => {
  const { sessions } = normalizeUsageObservations([
    raw({ startAtMonotonicMs: 0, endAtMonotonicMs: null }),
    raw({ startAtMonotonicMs: 5000, endAtMonotonicMs: 6000 }),
  ]);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].endAtMonotonicMs, null);
  assert.equal(sessions[0].coverageGap, true);
});

test('keeps an in-progress session open with no end time', () => {
  const { sessions } = normalizeUsageObservations([raw({ startAtMonotonicMs: 0, endAtMonotonicMs: null })]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].endAtMonotonicMs, null);
});

test('detects a reboot from a monotonic clock reset', () => {
  const { integrityEvents } = normalizeUsageObservations([
    raw({ startAtMonotonicMs: 10_000, endAtMonotonicMs: 11_000, startAtWallClock: new Date('2026-01-01T00:00:10.000Z') }),
    raw({ startAtMonotonicMs: 100, endAtMonotonicMs: 500, startAtWallClock: new Date('2026-01-01T00:05:00.000Z') }),
  ]);
  assert.equal(integrityEvents.some((event) => event.kind === 'REBOOT'), true);
});

test('detects a wall-clock rollback independent of monotonic progression', () => {
  const { integrityEvents } = normalizeUsageObservations([
    raw({ startAtMonotonicMs: 0, endAtMonotonicMs: 1000, startAtWallClock: new Date('2026-06-01T00:00:00.000Z') }),
    raw({ startAtMonotonicMs: 2000, endAtMonotonicMs: 3000, startAtWallClock: new Date('2026-01-01T00:00:00.000Z') }),
  ]);
  assert.equal(integrityEvents.some((event) => event.kind === 'WALL_CLOCK_ROLLBACK'), true);
});

test('keeps different apps fully independent', () => {
  const { sessions } = normalizeUsageObservations([
    raw({ appToken: 'app-a', startAtMonotonicMs: 0, endAtMonotonicMs: 1000 }),
    raw({ appToken: 'app-b', startAtMonotonicMs: 500, endAtMonotonicMs: 1500 }),
  ]);
  assert.equal(sessions.length, 2);
});

test('sumSessionDurationMs closes an open session against a supplied current instant', () => {
  const { sessions } = normalizeUsageObservations([raw({ startAtMonotonicMs: 0, endAtMonotonicMs: null })]);
  assert.equal(sumSessionDurationMs(sessions, 'app-a', 5000), 5000);
  assert.equal(sumSessionDurationMs(sessions, 'app-a'), 0);
});
