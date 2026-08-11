import assert from 'node:assert/strict';
import test from 'node:test';
import { toZonedWallClock } from '../../dist/schedule/timezone.js';

test('resolves weekday/hour/minute for a fixed UTC instant in a fixed-offset zone', () => {
  const zoned = toZonedWallClock(new Date('2026-01-07T13:30:00.000Z'), 'Asia/Riyadh');
  assert.equal(zoned.hour, 16);
  assert.equal(zoned.minute, 30);
  assert.equal(zoned.weekday, 3); // Wednesday
  assert.equal(zoned.localDate, '2026-01-07');
});

test('handles a DST spring-forward transition via ICU, not hand-rolled offset math', () => {
  // 2026-03-08 07:00 UTC is 02:00 EST (UTC-5) before the US spring-forward,
  // and 07:00 UTC one week later is 03:00 EDT (UTC-4) after it -- the
  // absolute UTC instant needed to reach the same wall-clock hour shifts by
  // an hour across the transition, which only holds if DST is honored.
  const before = toZonedWallClock(new Date('2026-03-01T07:00:00.000Z'), 'America/New_York');
  const after = toZonedWallClock(new Date('2026-03-15T07:00:00.000Z'), 'America/New_York');
  assert.equal(before.hour, 2);
  assert.equal(after.hour, 3);
});

test('the same instant resolves to different wall clocks in different timezones (timezone change)', () => {
  const instant = new Date('2026-06-01T12:00:00.000Z');
  const riyadh = toZonedWallClock(instant, 'Asia/Riyadh');
  const losAngeles = toZonedWallClock(instant, 'America/Los_Angeles');
  assert.notEqual(riyadh.hour, losAngeles.hour);
});

test('rejects an unrecognized IANA zone instead of silently defaulting to UTC', () => {
  assert.throws(() => toZonedWallClock(new Date(), 'Not/A_Zone'), RangeError);
});
