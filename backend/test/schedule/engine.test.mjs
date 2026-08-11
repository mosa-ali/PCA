import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSchedule } from '../../dist/schedule/engine.js';

function window(overrides = {}) {
  return {
    id: 'w1',
    kind: 'BLOCK_PERIOD',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: { hour: 0, minute: 0 },
    end: { hour: 23, minute: 59 },
    appScope: 'ALL',
    timezone: 'Asia/Riyadh',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    nowUtc: new Date('2026-01-07T12:00:00.000Z'),
    timezone: 'Asia/Riyadh',
    appToken: 'app-a',
    windows: [],
    bonusGrants: [],
    exceptions: [],
    dailyLimit: undefined,
    enforcementCapability: 'ENFORCED',
    connectivity: 'ONLINE',
    lastPolicySyncAtUtc: new Date('2026-01-07T00:00:00.000Z'),
    ...overrides,
  };
}

test('overlapping block-period windows both block without ambiguity or crash', () => {
  const w1 = window({ id: 'w1', start: { hour: 8, minute: 0 }, end: { hour: 12, minute: 0 } });
  const w2 = window({ id: 'w2', start: { hour: 10, minute: 0 }, end: { hour: 14, minute: 0 } });
  const result = evaluateSchedule(baseInput({ nowUtc: new Date('2026-01-07T08:00:00.000Z'), windows: [w1, w2] }));
  assert.equal(result.decision, 'BLOCKED_PERIOD');
});

test('cross-midnight bedtime blocks both before and after midnight, but not midday', () => {
  const bedtime = window({
    id: 'bedtime',
    kind: 'BEDTIME',
    daysOfWeek: [3], // Wednesday 2026-01-07
    start: { hour: 22, minute: 0 },
    end: { hour: 6, minute: 0 },
  });
  const beforeMidnight = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T20:00:00.000Z'), windows: [bedtime] }), // 23:00 Riyadh, Wed
  );
  assert.equal(beforeMidnight.decision, 'BLOCKED_BEDTIME');

  const afterMidnight = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T23:00:00.000Z'), windows: [bedtime] }), // 02:00 Riyadh, Thu
  );
  assert.equal(afterMidnight.decision, 'BLOCKED_BEDTIME');

  const midday = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T09:00:00.000Z'), windows: [bedtime] }), // 12:00 Riyadh, Wed
  );
  assert.equal(midday.decision, 'ALLOWED');
});

test('weekday rollover only blocks the calendar day after a matching start day', () => {
  const bedtime = window({
    id: 'bedtime',
    kind: 'BEDTIME',
    daysOfWeek: [5], // Friday 2026-01-09
    start: { hour: 23, minute: 0 },
    end: { hour: 7, minute: 0 },
  });
  const saturdayEarlyMorning = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-09T22:00:00.000Z'), windows: [bedtime] }), // 01:00 Riyadh Sat, after Fri bedtime
  );
  assert.equal(saturdayEarlyMorning.decision, 'BLOCKED_BEDTIME');

  const sundayEarlyMorning = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-10T22:00:00.000Z'), windows: [bedtime] }), // 01:00 Riyadh Sun, after Sat (not configured)
  );
  assert.equal(sundayEarlyMorning.decision, 'ALLOWED');
});

test('DST transition shifts which UTC instant maps to a fixed local bedtime hour', () => {
  const bedtime = window({
    id: 'bedtime',
    kind: 'BEDTIME',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: { hour: 2, minute: 0 },
    end: { hour: 3, minute: 0 },
    timezone: 'America/New_York',
  });
  const beforeDst = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-03-01T07:30:00.000Z'), timezone: 'America/New_York', windows: [bedtime] }),
  );
  assert.equal(beforeDst.decision, 'BLOCKED_BEDTIME');
  const sameAbsoluteOffsetAfterDst = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-03-15T07:30:00.000Z'), timezone: 'America/New_York', windows: [bedtime] }),
  );
  assert.equal(sameAbsoluteOffsetAfterDst.decision, 'ALLOWED');
});

test('timezone change alone can flip the daily-limit local-date reset', () => {
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const sameZone = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T12:00:00.000Z'), timezone: 'Asia/Riyadh', dailyLimit }),
  );
  assert.equal(sameZone.decision, 'BLOCKED_LIMIT_REACHED');

  const travelledZone = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T12:00:00.000Z'), timezone: 'Pacific/Kiritimati', dailyLimit }),
  );
  assert.equal(travelledZone.decision, 'ALLOWED');
});

test('bonus grant extends the limit only while active, then reverts on expiry', () => {
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const grant = {
    id: 'bonus-1',
    appScope: 'ALL',
    extraMinutes: 15,
    grantedAtUtc: new Date('2026-01-07T09:00:00.000Z'),
    expiresAtUtc: new Date('2026-01-07T09:15:00.000Z'),
  };
  const duringGrant = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T09:05:00.000Z'), dailyLimit, bonusGrants: [grant] }),
  );
  assert.equal(duringGrant.decision, 'ALLOWED_BONUS');

  const afterExpiry = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T09:20:00.000Z'), dailyLimit, bonusGrants: [grant] }),
  );
  assert.equal(afterExpiry.decision, 'BLOCKED_LIMIT_REACHED');
});

test('precedence: parent exception overrides an active bedtime window', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const exception = {
    id: 'exc-1',
    appScope: 'ALL',
    startAtUtc: new Date('2026-01-07T11:00:00.000Z'),
    endAtUtc: new Date('2026-01-07T13:00:00.000Z'),
  };
  const result = evaluateSchedule(baseInput({ windows: [bedtime], exceptions: [exception] }));
  assert.equal(result.decision, 'ALLOWED_EXCEPTION');
});

test('precedence: school mode blocks an app not on its allow scope even without any block period', () => {
  const schoolMode = window({ id: 'school', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app'] } });
  const result = evaluateSchedule(baseInput({ windows: [schoolMode], appToken: 'game-app' }));
  assert.equal(result.decision, 'BLOCKED_SCHOOL_MODE');
});

test('precedence: enforcement-unavailable reports the intended decision instead of a bare block', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const result = evaluateSchedule(baseInput({ windows: [bedtime], enforcementCapability: 'UNAVAILABLE' }));
  assert.equal(result.decision, 'ENFORCEMENT_UNAVAILABLE');
  assert.equal(result.intendedDecision, 'BLOCKED_BEDTIME');
});

test('enforcement-unavailable does not suppress an ALLOWED verdict', () => {
  const result = evaluateSchedule(baseInput({ enforcementCapability: 'UNAVAILABLE' }));
  assert.equal(result.decision, 'ALLOWED');
});

test('offline evaluation is identical to online evaluation given the same cached policy', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const online = evaluateSchedule(baseInput({ windows: [bedtime], connectivity: 'ONLINE' }));
  const offline = evaluateSchedule(baseInput({ windows: [bedtime], connectivity: 'OFFLINE' }));
  assert.deepEqual(online, offline);
});

test('offline restart with no policy sync yet still evaluates deterministically off cached (empty) policy', () => {
  const result = evaluateSchedule(baseInput({ connectivity: 'OFFLINE', lastPolicySyncAtUtc: null }));
  assert.equal(result.decision, 'ALLOWED');
});

test('invalid window configuration is rejected without crashing and without silently allowing', () => {
  const malformed = window({ start: { hour: 99, minute: 0 } });
  const result = evaluateSchedule(baseInput({ windows: [malformed] }));
  assert.equal(result.decision, 'INVALID_CONFIG');
  assert.ok(result.configErrors.length > 0);
});

test('empty daysOfWeek is rejected as invalid configuration', () => {
  const malformed = window({ daysOfWeek: [] });
  const result = evaluateSchedule(baseInput({ windows: [malformed] }));
  assert.equal(result.decision, 'INVALID_CONFIG');
});
