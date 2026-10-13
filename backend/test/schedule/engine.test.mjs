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

test('malformed daily-limit counters and anchors cannot become a fresh allowance', () => {
  const valid = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const malformedLimits = [
    { ...valid, usedMinutesToday: -1 },
    { ...valid, usedMinutesToday: Number.NaN },
    { ...valid, limitMinutes: -1 },
    { ...valid, anchorLocalDate: 'not-a-date' },
    { ...valid, anchorLocalDate: '2026-02-30' },
  ];

  for (const dailyLimit of malformedLimits) {
    const result = evaluateSchedule(baseInput({ dailyLimit }));
    assert.equal(result.decision, 'INVALID_CONFIG', JSON.stringify(dailyLimit));
    assert.ok(result.configErrors?.length);
  }
});

test('invalid runtime evaluation instants fail closed as INVALID_CONFIG', () => {
  const malformedInstants = [new Date(Number.NaN), new Date(Number.POSITIVE_INFINITY), null, '2026-01-07T12:00:00.000Z'];
  for (const nowUtc of malformedInstants) {
    const result = evaluateSchedule(baseInput({ nowUtc }));
    assert.equal(result.decision, 'INVALID_CONFIG');
    assert.ok(result.configErrors?.some((error) => error.includes('evaluation time')));
  }
});

test('missing or malformed app identity fails closed before app-scoped policy can fall through to ALLOWED', () => {
  const scopedBlock = window({ kind: 'BLOCK_PERIOD', appScope: { apps: ['app-a'] } });
  for (const appToken of ['', null, undefined, 7]) {
    const result = evaluateSchedule(baseInput({ appToken, windows: [scopedBlock] }));
    assert.equal(result.decision, 'INVALID_CONFIG', String(appToken));
    assert.ok(result.configErrors?.some((error) => error.includes('app token')));
  }
});

test('invalid evaluation timezone with a daily limit returns INVALID_CONFIG instead of throwing', () => {
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 0, anchorLocalDate: '2026-01-07' };
  for (const timezone of ['Not/A_Zone', '', null]) {
    const result = evaluateSchedule(baseInput({ timezone, dailyLimit }));
    assert.equal(result.decision, 'INVALID_CONFIG', String(timezone));
    assert.ok(result.configErrors?.some((error) => error.includes('evaluation timezone')));
  }
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

test('malformed active bonus grants cannot turn an invalid allowance into ALLOWED_BONUS', () => {
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const malformedGrants = [
    { id: 'nan', appScope: 'ALL', extraMinutes: Number.NaN,
      grantedAtUtc: new Date('2026-01-07T09:00:00.000Z'), expiresAtUtc: new Date('2026-01-07T10:00:00.000Z') },
    { id: 'negative', appScope: 'ALL', extraMinutes: -1,
      grantedAtUtc: new Date('2026-01-07T09:00:00.000Z'), expiresAtUtc: new Date('2026-01-07T10:00:00.000Z') },
    { id: 'bad-dates', appScope: 'ALL', extraMinutes: 15,
      grantedAtUtc: new Date(Number.NaN), expiresAtUtc: new Date('2026-01-07T10:00:00.000Z') },
    { id: 'null-granted-at', appScope: 'ALL', extraMinutes: 15,
      grantedAtUtc: null, expiresAtUtc: new Date('2026-01-07T10:00:00.000Z') },
    { id: 'string-expires-at', appScope: 'ALL', extraMinutes: 15,
      grantedAtUtc: new Date('2026-01-07T09:00:00.000Z'), expiresAtUtc: '2026-01-07T10:00:00.000Z' },
  ];

  for (const bonusGrant of malformedGrants) {
    const result = evaluateSchedule(baseInput({ dailyLimit, bonusGrants: [bonusGrant] }));
    assert.equal(result.decision, 'INVALID_CONFIG', bonusGrant.id);
    assert.ok(result.configErrors?.length);
  }
});

test('malformed parent exception intervals fail closed before they can authorize', () => {
  const malformedExceptions = [
    { id: 'equal', appScope: 'ALL', startAtUtc: new Date('2026-01-07T11:00:00.000Z'), endAtUtc: new Date('2026-01-07T11:00:00.000Z') },
    { id: 'reversed', appScope: 'ALL', startAtUtc: new Date('2026-01-07T12:00:00.000Z'), endAtUtc: new Date('2026-01-07T11:00:00.000Z') },
    { id: 'non-finite-start', appScope: 'ALL', startAtUtc: new Date(Number.NaN), endAtUtc: new Date('2026-01-07T13:00:00.000Z') },
    { id: 'non-finite-end', appScope: 'ALL', startAtUtc: new Date('2026-01-07T11:00:00.000Z'), endAtUtc: new Date(Number.NaN) },
    { id: 'missing-start', appScope: 'ALL', startAtUtc: null, endAtUtc: new Date('2026-01-07T13:00:00.000Z') },
  ];

  for (const exception of malformedExceptions) {
    const result = evaluateSchedule(baseInput({ exceptions: [exception] }));
    assert.equal(result.decision, 'INVALID_CONFIG', exception.id);
    assert.ok(result.configErrors?.some((error) => error.includes('parent exception') && error.includes('finite dates')));
  }
});

test('missing or empty schedule policy identifiers fail structural validation', () => {
  const malformedWindow = window({ id: '' });
  const windowResult = evaluateSchedule(baseInput({ windows: [malformedWindow] }));
  assert.equal(windowResult.decision, 'INVALID_CONFIG');
  assert.ok(windowResult.configErrors?.some((error) => error.includes('window id')));
  const missingWindowIdResult = evaluateSchedule(baseInput({ windows: [window({ id: undefined })] }));
  assert.equal(missingWindowIdResult.decision, 'INVALID_CONFIG');
  assert.ok(missingWindowIdResult.configErrors?.some((error) => error.includes('window id')));
  assert.equal(evaluateSchedule(baseInput({ windows: [window({ id: '  ' })] })).decision, 'INVALID_CONFIG');

  const grant = {
    id: '', appScope: 'ALL', extraMinutes: 5,
    grantedAtUtc: new Date('2026-01-07T11:00:00.000Z'),
    expiresAtUtc: new Date('2026-01-07T13:00:00.000Z'),
  };
  const grantResult = evaluateSchedule(baseInput({ bonusGrants: [grant] }));
  assert.equal(grantResult.decision, 'INVALID_CONFIG');
  assert.ok(grantResult.configErrors?.some((error) => error.includes('bonus grant') && error.includes('id')));
  const missingGrantIdResult = evaluateSchedule(baseInput({ bonusGrants: [{ ...grant, id: undefined }] }));
  assert.equal(missingGrantIdResult.decision, 'INVALID_CONFIG');
  assert.ok(missingGrantIdResult.configErrors?.some((error) => error.includes('bonus grant') && error.includes('id')));
  assert.equal(evaluateSchedule(baseInput({ bonusGrants: [{ ...grant, id: '\t ' }] })).decision, 'INVALID_CONFIG');

  const exception = {
    id: '', appScope: 'ALL',
    startAtUtc: new Date('2026-01-07T11:00:00.000Z'),
    endAtUtc: new Date('2026-01-07T13:00:00.000Z'),
  };
  const exceptionResult = evaluateSchedule(baseInput({ exceptions: [exception] }));
  assert.equal(exceptionResult.decision, 'INVALID_CONFIG');
  assert.ok(exceptionResult.configErrors?.some((error) => error.includes('parent exception') && error.includes('id')));
  const missingExceptionIdResult = evaluateSchedule(baseInput({ exceptions: [{ ...exception, id: undefined }] }));
  assert.equal(missingExceptionIdResult.decision, 'INVALID_CONFIG');
  assert.ok(missingExceptionIdResult.configErrors?.some((error) => error.includes('parent exception') && error.includes('id')));
  assert.equal(evaluateSchedule(baseInput({ exceptions: [{ ...exception, id: '  ' }] })).decision, 'INVALID_CONFIG');
  for (const invalidException of [null, [], 'not-an-exception']) {
    const result = evaluateSchedule(baseInput({ exceptions: [invalidException] }));
    assert.equal(result.decision, 'INVALID_CONFIG');
    assert.ok(result.configErrors?.some((error) => error.includes('parent exception') && error.includes('object')));
  }
});

test('malformed app scopes in every schedule policy dimension fail closed', () => {
  const validException = {
    id: 'exception', appScope: 'ALL',
    startAtUtc: new Date('2026-01-07T11:00:00.000Z'), endAtUtc: new Date('2026-01-07T13:00:00.000Z'),
  };
  const validGrant = {
    id: 'bonus', appScope: 'ALL', extraMinutes: 5,
    grantedAtUtc: new Date('2026-01-07T11:00:00.000Z'), expiresAtUtc: new Date('2026-01-07T13:00:00.000Z'),
  };
  const cases = [
    { label: 'window', input: { windows: [window({ appScope: null })] } },
    { label: 'exception', input: { exceptions: [{ ...validException, appScope: null }] } },
    { label: 'bonus grant', input: { bonusGrants: [{ ...validGrant, appScope: null }] } },
    { label: 'daily limit', input: { dailyLimit: { appScope: null, limitMinutes: 30, usedMinutesToday: 0, anchorLocalDate: '2026-01-07' } } },
  ];

  for (const { label, input } of cases) {
    const result = evaluateSchedule(baseInput(input));
    assert.equal(result.decision, 'INVALID_CONFIG', label);
    assert.ok(result.configErrors?.some((error) => error.includes('appScope')), label);
  }
});

test('null policy entries and null daily limits return INVALID_CONFIG without throwing', () => {
  const malformedCases = [
    { label: 'null window', input: { windows: [null] } },
    { label: 'null window time', input: { windows: [window({ start: null })] } },
    { label: 'null bonus grant', input: { bonusGrants: [null] } },
    { label: 'null daily limit', input: { dailyLimit: null } },
  ];

  for (const { label, input } of malformedCases) {
    const result = evaluateSchedule(baseInput(input));
    assert.equal(result.decision, 'INVALID_CONFIG', label);
    assert.ok(result.configErrors?.length, label);
  }
});

test('unknown runtime schedule window kinds fail closed instead of falling through to ALLOWED', () => {
  const result = evaluateSchedule(baseInput({
    windows: [window({
      id: 'unknown-kind',
      kind: 'UNKNOWN',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      start: { hour: 0, minute: 0 },
      end: { hour: 0, minute: 0 },
      appScope: 'ALL',
    })],
  }));

  assert.equal(result.decision, 'INVALID_CONFIG');
  assert.ok(result.configErrors?.some((error) => error.includes('invalid kind')));
});

test('missing or null policy arrays return INVALID_CONFIG without throwing', () => {
  const malformedCases = [
    { label: 'null windows', input: { windows: null } },
    { label: 'missing windows', input: { windows: undefined } },
    { label: 'null bonus grants', input: { bonusGrants: null } },
    { label: 'missing bonus grants', input: { bonusGrants: undefined } },
    { label: 'null exceptions', input: { exceptions: null } },
    { label: 'missing exceptions', input: { exceptions: undefined } },
  ];

  for (const { label, input } of malformedCases) {
    const result = evaluateSchedule(baseInput(input));
    assert.equal(result.decision, 'INVALID_CONFIG', label);
    assert.ok(result.configErrors?.length, label);
  }
});

test('active bonus arithmetic rejects precision loss without rejecting irrelevant grants', () => {
  const grant = (id, extraMinutes, overrides = {}) => ({
    id,
    appScope: 'ALL',
    extraMinutes,
    grantedAtUtc: new Date('2026-01-07T11:00:00.000Z'),
    expiresAtUtc: new Date('2026-01-07T13:00:00.000Z'),
    ...overrides,
  });
  const maxSafe = Number.MAX_SAFE_INTEGER;
  const invalidCases = [
    {
      dailyLimit: { appScope: 'ALL', limitMinutes: 1, usedMinutesToday: 0, anchorLocalDate: '2026-01-07' },
      bonusGrants: [grant('base-plus-bonus-overflow', maxSafe)],
    },
    {
      dailyLimit: { appScope: 'ALL', limitMinutes: 0, usedMinutesToday: 0, anchorLocalDate: '2026-01-07' },
      bonusGrants: [grant('bonus-max', maxSafe), grant('bonus-extra', 1)],
    },
  ];

  for (const input of invalidCases) {
    const result = evaluateSchedule(baseInput(input));
    assert.equal(result.decision, 'INVALID_CONFIG');
    assert.ok(result.configErrors?.some((error) => error.includes('safe-integer range')));
  }

  const zeroLimit = { appScope: 'ALL', limitMinutes: 0, usedMinutesToday: 0, anchorLocalDate: '2026-01-07' };
  const irrelevantCases = [
    [
      grant('other-app-max', maxSafe, { appScope: { apps: ['other-app'] } }),
      grant('other-app-extra', 1, { appScope: { apps: ['other-app'] } }),
    ],
    [
      grant('expired-max', maxSafe, { expiresAtUtc: new Date('2026-01-07T12:00:00.000Z') }),
      grant('expired-extra', 1, { expiresAtUtc: new Date('2026-01-07T12:00:00.000Z') }),
    ],
  ];
  for (const bonusGrants of irrelevantCases) {
    const result = evaluateSchedule(baseInput({ dailyLimit: zeroLimit, bonusGrants }));
    assert.equal(result.decision, 'BLOCKED_LIMIT_REACHED');
    assert.ok(!result.configErrors?.some((error) => error.includes('safe-integer range')));
  }
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

// PCA-FR-130 principle "grant cannot silently disable parental bedtime/night-lock rules": an
// active bonus-time grant only ever extends the DAILY MINUTE LIMIT (precedence step 6) -- it must
// never reach past an active bedtime window (precedence step 2), which blocks its app scope
// unconditionally regardless of any bonus minutes still available.
test('an active bonus grant does not override an active bedtime window', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const grant = {
    id: 'bonus-1',
    appScope: 'ALL',
    extraMinutes: 60,
    grantedAtUtc: new Date('2026-01-07T00:00:00.000Z'),
    expiresAtUtc: new Date('2026-01-08T00:00:00.000Z'),
  };
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const result = evaluateSchedule(baseInput({ windows: [bedtime], bonusGrants: [grant], dailyLimit }));
  assert.equal(result.decision, 'BLOCKED_BEDTIME');
});

test('precedence: school mode blocks an app not on its allow scope even without any block period', () => {
  const schoolMode = window({ id: 'school', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app'] } });
  const result = evaluateSchedule(baseInput({ windows: [schoolMode], appToken: 'game-app' }));
  assert.equal(result.decision, 'BLOCKED_SCHOOL_MODE');
});

// FINDING-006: two simultaneously-active SCHOOL_MODE windows with
// different allow scopes must combine deterministically (intersection /
// most-restrictive-wins), never by picking whichever happens to appear
// first in `windows`.

test('FINDING-006: two overlapping school windows with different allow scopes -- app allowed by only one is blocked (intersection)', () => {
  const windowA = window({ id: 'school-a', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app'] } });
  const windowB = window({ id: 'school-b', kind: 'SCHOOL_MODE', appScope: { apps: ['calculator-app'] } });
  const forwardOrder = evaluateSchedule(baseInput({ windows: [windowA, windowB], appToken: 'homework-app' }));
  const reverseOrder = evaluateSchedule(baseInput({ windows: [windowB, windowA], appToken: 'homework-app' }));
  assert.equal(forwardOrder.decision, 'BLOCKED_SCHOOL_MODE');
  assert.equal(reverseOrder.decision, 'BLOCKED_SCHOOL_MODE');
  assert.deepEqual(forwardOrder, reverseOrder);
});

test('FINDING-006: app allowed by every simultaneously-active school window is allowed (intersection includes it)', () => {
  const windowA = window({ id: 'school-a', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app', 'calculator-app'] } });
  const windowB = window({ id: 'school-b', kind: 'SCHOOL_MODE', appScope: { apps: ['calculator-app'] } });
  const result = evaluateSchedule(baseInput({ windows: [windowA, windowB], appToken: 'calculator-app' }));
  assert.equal(result.decision, 'ALLOWED');
});

test('FINDING-006: decision is order-independent (not array-insertion-order authority) regardless of which windows exclude the app', () => {
  const windowA = window({ id: 'school-a', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app'] } });
  const windowB = window({ id: 'school-b', kind: 'SCHOOL_MODE', appScope: 'ALL' });
  const orderAB = evaluateSchedule(baseInput({ windows: [windowA, windowB], appToken: 'game-app' }));
  const orderBA = evaluateSchedule(baseInput({ windows: [windowB, windowA], appToken: 'game-app' }));
  assert.equal(orderAB.decision, 'BLOCKED_SCHOOL_MODE');
  assert.deepEqual(orderAB, orderBA);
  // windowB (ALL scope) never excludes the app -- only windowA does, so it alone is attributed.
  assert.deepEqual(orderAB.matchedWindowIds, ['school-a']);
});

test('FINDING-006: "same priority" -- neither window is treated as authoritative; both contribute to the block reason', () => {
  const windowA = window({ id: 'school-a', kind: 'SCHOOL_MODE', appScope: { apps: ['homework-app'] } });
  const windowB = window({ id: 'school-b', kind: 'SCHOOL_MODE', appScope: { apps: ['calculator-app'] } });
  const result = evaluateSchedule(baseInput({ windows: [windowA, windowB], appToken: 'game-app' }));
  assert.equal(result.decision, 'BLOCKED_SCHOOL_MODE');
  assert.deepEqual(result.matchedWindowIds, ['school-a', 'school-b']);
  assert.equal(result.matchedWindowId, 'school-a'); // stable lexicographic pick, not insertion order
});

test('FINDING-006: cross-midnight overlap between two school windows still combines by intersection', () => {
  const windowA = window({
    id: 'school-a',
    kind: 'SCHOOL_MODE',
    daysOfWeek: [3], // Wednesday 2026-01-07
    start: { hour: 22, minute: 0 },
    end: { hour: 6, minute: 0 },
    appScope: { apps: ['homework-app'] },
  });
  const windowB = window({
    id: 'school-b',
    kind: 'SCHOOL_MODE',
    daysOfWeek: [3],
    start: { hour: 23, minute: 0 },
    end: { hour: 5, minute: 0 },
    appScope: 'ALL',
  });
  // 02:00 Riyadh Thu (after both cross-midnight windows started Wed) -- both active, intersection excludes game-app.
  const blocked = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T23:00:00.000Z'), windows: [windowA, windowB], appToken: 'game-app' }),
  );
  assert.equal(blocked.decision, 'BLOCKED_SCHOOL_MODE');
  assert.deepEqual(blocked.matchedWindowIds, ['school-a']);

  const allowed = evaluateSchedule(
    baseInput({ nowUtc: new Date('2026-01-07T23:00:00.000Z'), windows: [windowA, windowB], appToken: 'homework-app' }),
  );
  assert.equal(allowed.decision, 'ALLOWED');
});

test('FINDING-006: DST-affected overlap between two school windows still combines by intersection', () => {
  const windowA = window({
    id: 'school-a',
    kind: 'SCHOOL_MODE',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: { hour: 8, minute: 0 },
    end: { hour: 10, minute: 0 },
    appScope: { apps: ['homework-app'] },
    timezone: 'America/New_York',
  });
  const windowB = window({
    id: 'school-b',
    kind: 'SCHOOL_MODE',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    start: { hour: 8, minute: 0 },
    end: { hour: 10, minute: 0 },
    appScope: 'ALL',
    timezone: 'America/New_York',
  });
  // 2026-03-15T13:30:00Z is 09:30 EDT (after the spring-forward), inside both windows.
  const result = evaluateSchedule(
    baseInput({
      nowUtc: new Date('2026-03-15T13:30:00.000Z'),
      timezone: 'America/New_York',
      windows: [windowA, windowB],
      appToken: 'game-app',
    }),
  );
  assert.equal(result.decision, 'BLOCKED_SCHOOL_MODE');
  assert.deepEqual(result.matchedWindowIds, ['school-a']);
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

// ---- doc 20 PCA-FR-113: schedule/parental-control explanations must be genuinely localized, never a raw English/enum fallback ----

test('evaluateSchedule defaults reasonMessage to English when no locale is supplied, and reason stays the untranslated machine string', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME' });
  const result = evaluateSchedule(baseInput({ windows: [bedtime] }));
  assert.equal(result.decision, 'BLOCKED_BEDTIME');
  assert.equal(result.reason, 'Active bedtime window bedtime.');
  assert.equal(result.reasonMessage, 'Blocked by an active bedtime window.');
});

test('evaluateSchedule produces a genuine Arabic reasonMessage when locale=ar is requested, with no English fallback leaking in', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME' });
  const result = evaluateSchedule(baseInput({ windows: [bedtime] }), 'ar');
  assert.equal(result.decision, 'BLOCKED_BEDTIME');
  assert.equal(result.reasonMessage, 'محظور بواسطة فترة نوم نشطة.');
  assert.equal(/[A-Za-z]/.test(result.reasonMessage), false);
  // `reason` (the stable machine-diagnostic string) is untouched by locale.
  assert.equal(result.reason, 'Active bedtime window bedtime.');
});

test('evaluateSchedule localizes BLOCKED_LIMIT_REACHED with the real numeric placeholders substituted, in both locales', () => {
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 30, anchorLocalDate: '2026-01-07' };
  const enResult = evaluateSchedule(baseInput({ dailyLimit }), 'en');
  const arResult = evaluateSchedule(baseInput({ dailyLimit }), 'ar');
  assert.equal(enResult.decision, 'BLOCKED_LIMIT_REACHED');
  assert.equal(enResult.reasonMessage, 'Blocked: used 30 of 30 minutes today.');
  assert.equal(arResult.reasonMessage, 'محظور: تم استخدام 30 من أصل 30 دقيقة اليوم.');
  assert.equal(/[A-Za-z]/.test(arResult.reasonMessage), false);
});

test('evaluateSchedule localizes ENFORCEMENT_UNAVAILABLE with the intended decision preserved and the capability placeholder substituted', () => {
  const bedtime = window({ id: 'bedtime', kind: 'BEDTIME' });
  const result = evaluateSchedule(baseInput({ windows: [bedtime], enforcementCapability: 'DEGRADED' }), 'ar');
  assert.equal(result.decision, 'ENFORCEMENT_UNAVAILABLE');
  assert.equal(result.intendedDecision, 'BLOCKED_BEDTIME');
  assert.equal(result.reasonMessage, 'لا يمكن تأكيد تطبيق هذا القرار حاليًا (الإمكانية: DEGRADED).');
  assert.equal(/[A-Za-z]/.test(result.reasonMessage.replace('DEGRADED', '')), false);
});

test('evaluateSchedule localizes ALLOWED_BONUS with the bonus-minutes placeholder substituted, in both locales', () => {
  const bonusGrants = [
    {
      id: 'bonus-1',
      appScope: 'ALL',
      extraMinutes: 15,
      grantedAtUtc: new Date('2026-01-07T00:00:00.000Z'),
      expiresAtUtc: new Date('2026-01-08T00:00:00.000Z'),
    },
  ];
  const dailyLimit = { appScope: 'ALL', limitMinutes: 30, usedMinutesToday: 5, anchorLocalDate: '2026-01-07' };
  const enResult = evaluateSchedule(baseInput({ dailyLimit, bonusGrants }), 'en');
  const arResult = evaluateSchedule(baseInput({ dailyLimit, bonusGrants }), 'ar');
  assert.equal(enResult.decision, 'ALLOWED_BONUS');
  assert.equal(enResult.reasonMessage, 'Allowed with 15 active bonus minutes.');
  assert.equal(arResult.reasonMessage, 'مسموح مع 15 دقيقة إضافية نشطة.');
  assert.equal(/[A-Za-z]/.test(arResult.reasonMessage), false);
});
