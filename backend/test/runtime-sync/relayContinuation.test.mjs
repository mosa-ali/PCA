import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRelayQueuePositions, isRelayQueuePosition, validateRelayQueuePageInput } from '../../dist/relay/queuePage.js';
import { decodeRelayContinuation, encodeRelayContinuation, InvalidRelayCursorError, MAX_RELAY_CURSOR_BYTES, RELAY_CAMPAIGN_TTL_MS } from '../../dist/runtime-sync/relayContinuation.js';

const now = new Date('2026-10-07T00:00:00.000Z');
const scope = { familyId: 'family-1', recipientDeviceId: 'device-1', sessionIncarnation: 'a'.repeat(64) };
const continuation = () => ({ version: 1, scope, after: { createdAtMs: 1, messageId: 'a' },
  highWater: { createdAtMs: 2, messageId: 'z' }, startedAtMs: now.getTime() });
const wire = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('navigation roundtrips exact scoped keysets without storing a bearer', () => {
  const value = continuation();
  assert.deepEqual(decodeRelayContinuation(encodeRelayContinuation(value), scope, now), value);
  assert.equal(Object.keys(value.scope).length, 3);
});

test('navigation cannot cross authenticated family, recipient or session incarnation', () => {
  const cursor = encodeRelayContinuation(continuation());
  for (const replacement of [{ familyId: 'other' }, { recipientDeviceId: 'other' }, { sessionIncarnation: 'b'.repeat(64) }]) {
    assert.throws(() => decodeRelayContinuation(cursor, { ...scope, ...replacement }, now), InvalidRelayCursorError);
  }
});

test('navigation rejects malformed, inverted, expired and future claims', () => {
  for (const value of [
    { ...continuation(), version: 2 }, { ...continuation(), extra: true },
    { ...continuation(), after: continuation().highWater },
    { ...continuation(), highWater: { createdAtMs: 0, messageId: 'z' } },
    { ...continuation(), after: { createdAtMs: 1.5, messageId: 'a' } },
    { ...continuation(), startedAtMs: now.getTime() + 1 },
    { ...continuation(), startedAtMs: now.getTime() - RELAY_CAMPAIGN_TTL_MS },
    { ...continuation(), scope: { ...scope, extra: true } },
  ]) assert.throws(() => decodeRelayContinuation(wire(value), scope, now), InvalidRelayCursorError);
  for (const cursor of ['', '!', wire(continuation()) + '=', 'a'.repeat(MAX_RELAY_CURSOR_BYTES + 1)]) {
    assert.throws(() => decodeRelayContinuation(cursor, scope, now), InvalidRelayCursorError);
  }
});

test('full supported escaped IDs fit a bounded server cursor', () => {
  const escaped = '\u0001'.repeat(128);
  const value = { ...continuation(), scope: { ...scope, familyId: escaped, recipientDeviceId: escaped },
    after: { createdAtMs: 1, messageId: escaped }, highWater: { createdAtMs: 2, messageId: escaped } };
  const cursor = encodeRelayContinuation(value);
  assert.ok(cursor.length > 2048);
  assert.ok(cursor.length <= MAX_RELAY_CURSOR_BYTES);
  assert.deepEqual(decodeRelayContinuation(cursor, value.scope, now), value);
});

test('binary key ordering retains trailing spaces and supplementary Unicode', () => {
  const p = (messageId) => ({ createdAtMs: 1, messageId });
  assert.ok(compareRelayQueuePositions(p('A'), p('A ')) < 0);
  assert.ok(compareRelayQueuePositions(p('A '), p('A!')) < 0);
  assert.ok(compareRelayQueuePositions(p('\uE000'), p('\u{10000}')) < 0);
  assert.ok(isRelayQueuePosition(p('\u{10000}'.repeat(128))));
  assert.equal(isRelayQueuePosition(p('\uD800')), false);
  const unicode = { ...continuation(), after: p('\uE000'), highWater: p('\u{10000}') };
  assert.deepEqual(decodeRelayContinuation(encodeRelayContinuation(unicode), scope, now), unicode);
});

test('page input validation preserves supported MySQL dates and finite row bounds', () => {
  const early = { createdAtMs: -30610224000000, messageId: 'early' };
  assert.ok(isRelayQueuePosition(early));
  validateRelayQueuePageInput({ limit: 100, after: early, highWater: continuation().highWater });
  for (const input of [
    { limit: 0, after: null, highWater: null }, { limit: 101, after: null, highWater: null },
    { limit: 1.5, after: null, highWater: null },
    { limit: 1, after: continuation().after, highWater: null },
    { limit: 1, after: continuation().highWater, highWater: continuation().after },
  ]) assert.throws(() => validateRelayQueuePageInput(input), RangeError);
});

test('unsigned navigation can change only its own position, never its authenticated scope', () => {
  const value = { ...continuation(), after: { createdAtMs: 1, messageId: 'different-position' } };
  assert.deepEqual(decodeRelayContinuation(wire(value), scope, now), value);
  assert.throws(() => decodeRelayContinuation(wire({ ...value, scope: { ...scope, familyId: 'victim' } }), scope, now), InvalidRelayCursorError);
});
