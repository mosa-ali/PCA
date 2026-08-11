import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAdultSupervisionSurface,
  validateCustomMessage,
  validateDeliveryPolicy,
  validateSchedule,
  validateTargetScope,
  WellbeingValidationError,
  assertValidCustomMessage,
} from '../dist/validators.js';
import { WELLBEING_DELIVERY_SURFACES } from '../dist/types.js';
import { baseMessage } from './fixtures.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('a fully valid custom message has no issues', () => {
  assert.deepEqual(validateCustomMessage(baseMessage()), []);
});

test('assertValidCustomMessage throws WellbeingValidationError on an invalid message', () => {
  const invalid = baseMessage({ messageId: '' });
  assert.throws(() => assertValidCustomMessage(invalid), WellbeingValidationError);
});

// -- target validation --------------------------------------------------

test('ONE_CHILD target requires exactly one child id', () => {
  assert.deepEqual(validateTargetScope({ mode: 'ONE_CHILD', childProfileIds: [] }), [{ kind: 'invalid-target-scope' }]);
  assert.deepEqual(validateTargetScope({ mode: 'ONE_CHILD', childProfileIds: ['a', 'b'] }), [{ kind: 'invalid-target-scope' }]);
  assert.deepEqual(validateTargetScope({ mode: 'ONE_CHILD', childProfileIds: ['a'] }), []);
});

test('MULTIPLE_CHILDREN target requires at least two distinct non-blank ids', () => {
  assert.equal(validateTargetScope({ mode: 'MULTIPLE_CHILDREN', childProfileIds: ['a'] }).length > 0, true);
  assert.equal(validateTargetScope({ mode: 'MULTIPLE_CHILDREN', childProfileIds: ['a', 'a'] }).length > 0, true);
  assert.equal(validateTargetScope({ mode: 'MULTIPLE_CHILDREN', childProfileIds: ['a', ' '] }).length > 0, true);
  assert.deepEqual(validateTargetScope({ mode: 'MULTIPLE_CHILDREN', childProfileIds: ['a', 'b'] }), []);
});

test('ALL_CHILDREN target needs no explicit ids', () => {
  assert.deepEqual(validateTargetScope({ mode: 'ALL_CHILDREN', childProfileIds: [] }), []);
});

// -- schedule validation --------------------------------------------------

test('date ordering is enforced', () => {
  const issues = validateSchedule({ startDate: '2026-06-01', endDate: '2026-01-01', daysOfWeek: [], timeWindows: [] });
  assert.equal(issues.some((i) => i.kind === 'date-order'), true);
});

test('equal start/end dates are accepted as a single-day window', () => {
  const issues = validateSchedule({ startDate: '2026-06-01', endDate: '2026-06-01', daysOfWeek: [], timeWindows: [] });
  assert.equal(issues.some((i) => i.kind === 'date-order'), false);
});

test('malformed dates are rejected', () => {
  const issues = validateSchedule({ startDate: '2026-13-40', daysOfWeek: [], timeWindows: [] });
  assert.equal(issues.some((i) => i.kind === 'invalid-date'), true);
});

test('unknown day-of-week token is rejected', () => {
  const issues = validateSchedule({ daysOfWeek: ['FUNDAY'], timeWindows: [] });
  assert.equal(issues.some((i) => i.kind === 'unknown-day-of-week'), true);
});

test('a midnight-crossing time window (start > end) is valid', () => {
  const issues = validateSchedule({ daysOfWeek: [], timeWindows: [{ startMinute: 22 * 60, endMinute: 1 * 60 }] });
  assert.deepEqual(issues, []);
});

test('a zero-duration time window (start === end) is rejected', () => {
  const issues = validateSchedule({ daysOfWeek: [], timeWindows: [{ startMinute: 60, endMinute: 60 }] });
  assert.equal(issues.some((i) => i.kind === 'invalid-time-window'), true);
});

test('an out-of-range time window minute is rejected', () => {
  const issues = validateSchedule({ daysOfWeek: [], timeWindows: [{ startMinute: -1, endMinute: 1440 }] });
  assert.equal(issues.some((i) => i.kind === 'invalid-time-window'), true);
});

test('a malformed timezone identifier is rejected', () => {
  const issues = validateSchedule({ daysOfWeek: [], timeWindows: [], timezoneId: 'not a tz;drop table' });
  assert.equal(issues.some((i) => i.kind === 'invalid-timezone'), true);
});

test('a well-formed IANA-shaped timezone identifier is accepted', () => {
  const issues = validateSchedule({ daysOfWeek: [], timeWindows: [], timezoneId: 'Asia/Riyadh' });
  assert.equal(issues.some((i) => i.kind === 'invalid-timezone'), false);
});

// -- frequency safety bounds ------------------------------------------------

test('a zero-second-equivalent cooldown is rejected', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 0, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.equal(issues.some((i) => i.kind === 'frequency-below-floor' && i.field === 'repeatCooldownMinutes'), true);
});

test('an unbounded maximumPerDay ("nag intensity") is rejected', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 100,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.equal(issues.some((i) => i.kind === 'frequency-above-ceiling'), true);
});

test('a below-floor minimum interval is rejected', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['PERIODIC'], minimumIntervalMinutes: 1, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.equal(issues.some((i) => i.kind === 'frequency-below-floor' && i.field === 'minimumIntervalMinutes'), true);
});

test('frequency bounds within product-safe range are accepted', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.deepEqual(issues, []);
});

test('an unrecognised trigger is rejected', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['ALWAYS_ON'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.equal(issues.some((i) => i.kind === 'unknown-trigger'), true);
});

test('at least one trigger is required', () => {
  const issues = validateDeliveryPolicy({
    triggers: [], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: false,
  });
  assert.equal(issues.some((i) => i.kind === 'no-triggers'), true);
});

// -- adult supervision --------------------------------------------------

test('requiresAdultSupervision=true with lockScreenAllowed=true is rejected', () => {
  const issues = validateDeliveryPolicy({
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: true, dismissible: true, snoozable: true, requiresAdultSupervision: true,
  });
  assert.equal(issues.some((i) => i.kind === 'adult-supervision-lock-screen-conflict'), true);
});

test('requiresAdultSupervision=true forbids the LOCK_SCREEN_REDACTED surface', () => {
  const delivery = {
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: true,
  };
  const issues = validateAdultSupervisionSurface(delivery, 'LOCK_SCREEN_REDACTED');
  assert.equal(issues.some((i) => i.kind === 'adult-supervision-lock-screen-conflict'), true);
});

test('requiresAdultSupervision=true forbids unattended STANDARD_NOTIFICATION delivery', () => {
  const delivery = {
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: true,
  };
  const issues = validateAdultSupervisionSurface(delivery, 'STANDARD_NOTIFICATION');
  assert.equal(issues.some((i) => i.kind === 'adult-supervision-unattended-notification'), true);
});

test('requiresAdultSupervision=true still allows IN_APP_SMALL_CARD', () => {
  const delivery = {
    triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3,
    repeatCooldownMinutes: 30, lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: true,
  };
  assert.deepEqual(validateAdultSupervisionSurface(delivery, 'IN_APP_SMALL_CARD'), []);
});

test('the permitted delivery surface list never includes a full-screen or system-impersonating surface', () => {
  for (const surface of WELLBEING_DELIVERY_SURFACES) {
    assert.notEqual(surface, 'FULL_SCREEN_MESSAGE');
    assert.notEqual(surface, 'SYSTEM_LOCKSCREEN_REPLACEMENT');
    assert.notEqual(surface, 'SYSTEM_SECURITY_ALERT_IMPERSONATION');
  }
});

// -- full message validation --------------------------------------------------

test('an Arabic-only custom message with no English variant is valid', () => {
  const message = baseMessage({
    languageTexts: { ar: { title: 'قل شكرا', body: 'أخبر أحد أفراد عائلتك بالشكر اليوم.' } },
  });
  assert.deepEqual(validateCustomMessage(message), []);
});

test('a message with zero language texts is rejected', () => {
  const message = baseMessage({ languageTexts: {} });
  assert.equal(validateCustomMessage(message).some((i) => i.kind === 'no-language-text'), true);
});

test('an unrecognised category is rejected', () => {
  const message = clone(baseMessage());
  message.category = 'PUNITIVE_STREAK';
  assert.equal(validateCustomMessage(message).some((i) => i.kind === 'unknown-category'), true);
});
