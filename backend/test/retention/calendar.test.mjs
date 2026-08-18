import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFixedIntervalExpiryInstant, computeCalendarMonthExpiryInstant } from '../../dist/retention/calendar.js';

test('14 days is an exact 14*24h UTC interval, timezone-independent', () => {
  const event = new Date('2026-01-01T10:00:00.000Z');
  const expiry = computeFixedIntervalExpiryInstant(event, 14);
  assert.equal(expiry.toISOString(), '2026-01-15T10:00:00.000Z');
});

test('calendar and fixed retention arithmetic reject invalid inputs instead of returning invalid dates', () => {
  assert.throws(() => computeFixedIntervalExpiryInstant(new Date(Number.NaN), 14), RangeError);
  assert.throws(() => computeFixedIntervalExpiryInstant(new Date('2026-01-01T00:00:00.000Z'), -1), RangeError);
  assert.throws(() => computeCalendarMonthExpiryInstant(new Date('2026-01-01T00:00:00.000Z'), 'UTC', 0), RangeError);
});

test('1-month calendar arithmetic in UTC-fixed-offset zone', () => {
  const event = new Date('2026-01-15T12:00:00.000Z'); // 15:00 Riyadh (UTC+3)
  const expiry = computeCalendarMonthExpiryInstant(event, 'Asia/Riyadh', 1);
  assert.equal(expiry.toISOString(), '2026-02-15T12:00:00.000Z');
});

test('month-end overflow clamps to the target month final day (Jan 31 + 1 month -> Feb 28/29)', () => {
  const event = new Date('2026-01-31T12:00:00.000Z'); // 2026 is not a leap year
  const expiry = computeCalendarMonthExpiryInstant(event, 'UTC', 1);
  assert.equal(expiry.getUTCFullYear(), 2026);
  assert.equal(expiry.getUTCMonth(), 1); // February (0-indexed)
  assert.equal(expiry.getUTCDate(), 28);
});

test('leap year: Jan 31 2028 + 1 month clamps to Feb 29 (2028 is a leap year)', () => {
  const event = new Date('2028-01-31T00:00:00.000Z');
  const expiry = computeCalendarMonthExpiryInstant(event, 'UTC', 1);
  assert.equal(expiry.getUTCFullYear(), 2028);
  assert.equal(expiry.getUTCMonth(), 1);
  assert.equal(expiry.getUTCDate(), 29);
});

test('3 months spans a year boundary correctly', () => {
  const event = new Date('2026-11-15T00:00:00.000Z');
  const expiry = computeCalendarMonthExpiryInstant(event, 'UTC', 3);
  assert.equal(expiry.toISOString().slice(0, 10), '2027-02-15');
});

test('6 and 9 month windows produce the correct target month', () => {
  const event = new Date('2026-01-15T00:00:00.000Z');
  assert.equal(computeCalendarMonthExpiryInstant(event, 'UTC', 6).toISOString().slice(0, 10), '2026-07-15');
  assert.equal(computeCalendarMonthExpiryInstant(event, 'UTC', 9).toISOString().slice(0, 10), '2026-10-15');
});

test('DST: a 1-month window anchored before a US spring-forward resolves to the same LOCAL wall-clock time after it, not a UTC-shifted one', () => {
  // 2026-02-08T15:00:00Z is 07:00 America/Los_Angeles (PST, UTC-8) before the March DST transition.
  const event = new Date('2026-02-08T15:00:00.000Z');
  const expiry = computeCalendarMonthExpiryInstant(event, 'America/Los_Angeles', 1);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(expiry);
  const hour = parts.find((p) => p.type === 'hour').value;
  const minute = parts.find((p) => p.type === 'minute').value;
  assert.equal(`${hour}:${minute}`, '07:00', 'the expiry must land on 07:00 local time in March too, even though the UTC offset changed');
});

test('DST never manufactures EXTRA retention: the computed expiry is never later than a naive same-UTC-offset month-add would suggest by more than the actual DST shift (1 hour)', () => {
  const event = new Date('2026-02-08T15:00:00.000Z'); // 07:00 PST
  const expiry = computeCalendarMonthExpiryInstant(event, 'America/Los_Angeles', 1);
  const naiveNoTzShift = new Date('2026-03-08T15:00:00.000Z');
  const diffMs = Math.abs(expiry.getTime() - naiveNoTzShift.getTime());
  assert.ok(diffMs <= 60 * 60 * 1000, `expected at most a 1-hour DST-driven difference, got ${diffMs}ms`);
});

test('timezone move: an event near local midnight can fall on a different LOCAL calendar day per timezone, and each zone still computes its own correct +1-month calendar target from ITS OWN local date', () => {
  // 2026-01-31T23:00:00Z is 2026-02-01 02:00 in Asia/Riyadh (+3, already
  // rolled into February) but 2026-01-31 15:00 in America/Los_Angeles (-8,
  // still January) -- the two zones disagree about which calendar day (and
  // even month) the event falls on, so "+1 calendar month" must anchor to
  // each zone's OWN local date, not a shared UTC one.
  const event = new Date('2026-01-31T23:00:00.000Z');

  const riyadhExpiry = computeCalendarMonthExpiryInstant(event, 'Asia/Riyadh', 1);
  const riyadhLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(riyadhExpiry);
  assert.equal(riyadhLocal, '2026-03-01', 'Riyadh event was already locally Feb 1 -- +1 month lands on March 1');

  const losAngelesExpiry = computeCalendarMonthExpiryInstant(event, 'America/Los_Angeles', 1);
  const losAngelesLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(losAngelesExpiry);
  assert.equal(losAngelesLocal, '2026-02-28', 'LA event was still locally Jan 31 -- +1 month clamps to Feb 28 (2026 is not a leap year)');
});
