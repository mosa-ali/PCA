// Pure unit tests for the attribution state model and its backoff schedule.
// DB-free and fast: the schedule arithmetic is worth testing directly because it
// is the part that decides how long a quote waits before it is retried, and an
// off-by-one there would either hammer the scan or effectively stop retrying.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ATTRIBUTION_RETRY_BASE_DELAY_MS,
  ATTRIBUTION_RETRY_MAX_DELAY_MS,
  classifyUnattributableReason,
  isProvablyTerminal,
  nextAttributionAttemptAt,
} from '../../dist/commercialmaintenance/attributionRetry.js';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const delayOf = (attemptCount) => nextAttributionAttemptAt(attemptCount, NOW).getTime() - NOW.getTime();

test('the first failure schedules the base delay, and each further failure doubles it', () => {
  assert.equal(delayOf(0), ATTRIBUTION_RETRY_BASE_DELAY_MS, 'zero prior attempts must mean the base delay, not zero and not double');
  assert.equal(delayOf(1), ATTRIBUTION_RETRY_BASE_DELAY_MS * 2);
  assert.equal(delayOf(2), ATTRIBUTION_RETRY_BASE_DELAY_MS * 4);
  assert.equal(delayOf(3), ATTRIBUTION_RETRY_BASE_DELAY_MS * 8);
});

test('the delay is CAPPED, so a long-unattributable quote is still retried eventually', () => {
  // Without a cap the schedule would overflow into "never retried again", which
  // is terminalisation by arithmetic -- exactly what must not happen to a reason
  // code that is not provably permanent.
  for (const attemptCount of [10, 50, 1_000, 100_000]) {
    assert.equal(delayOf(attemptCount), ATTRIBUTION_RETRY_MAX_DELAY_MS, `attempt ${attemptCount} must be capped, not unbounded`);
  }
});

test('the delay is monotonically NON-DECREASING across the whole attempt range', () => {
  let previous = -1;
  for (let attemptCount = 0; attemptCount < 60; attemptCount++) {
    const delay = delayOf(attemptCount);
    assert.ok(delay >= previous, `delay went backwards at attempt ${attemptCount}`);
    assert.ok(Number.isFinite(delay) && delay > 0, `delay must stay a positive finite number at attempt ${attemptCount}`);
    previous = delay;
  }
});

test('a pathological attempt count cannot produce NaN, Infinity or a Date in the past', () => {
  for (const attemptCount of [-5, 0.5, Number.MAX_SAFE_INTEGER, Number.NaN, Number.POSITIVE_INFINITY]) {
    const next = nextAttributionAttemptAt(attemptCount, NOW);
    assert.ok(next instanceof Date && Number.isFinite(next.getTime()), `attempt count ${attemptCount} produced an invalid date`);
    assert.ok(next.getTime() > NOW.getTime(), `attempt count ${attemptCount} must schedule strictly into the future`);
  }
});

test('classifyUnattributableReason distinguishes the two reason codes, and null is the ONLY input that is absent', () => {
  assert.equal(classifyUnattributableReason(null), 'REFERENCE_ABSENT');
  assert.equal(classifyUnattributableReason(''), 'REFERENCE_UNRESOLVED', 'an empty-string reference is still a reference: resolving it is a lookup, not a missing column');
  assert.equal(classifyUnattributableReason('some-request-id'), 'REFERENCE_UNRESOLVED');
});

test('isProvablyTerminal is true for exactly one reason code', () => {
  assert.equal(isProvablyTerminal('REFERENCE_ABSENT'), true);
  assert.equal(isProvablyTerminal('REFERENCE_UNRESOLVED'), false, 'an unresolved reference is NOT proven permanent and must stay pending');
});

test('the persisted state vocabulary cannot express NOTIFIED, because the notification row is its only evidence', () => {
  const source = readFileSync(new URL('../../src/commercialmaintenance/attributionRetry.ts', import.meta.url), 'utf8');
  const persisted = /export type PersistedAttributionState = Exclude<AttributionState, '([A-Z_]+)'>;/.exec(source);
  assert.ok(persisted, 'could not locate PersistedAttributionState');
  assert.equal(persisted[1], 'NOTIFIED', 'the derived state must be the excluded one; storing it would create a second source of truth for a fact the exactly-once guarantee rests on');
});
