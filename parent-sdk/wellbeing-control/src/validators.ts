import { MAXIMUM_PER_DAY_CEILING, MINIMUM_INTERVAL_MINUTES_FLOOR, REPEAT_COOLDOWN_MINUTES_FLOOR } from './bounds.js';
import { validateLanguageText, type TextSafetyIssue } from './textSafety.js';
import type {
  CustomWellbeingMessage,
  DeliveryPolicy,
  ScheduleWindow,
  TargetScope,
  TimeWindow,
} from './types.js';
import { DAYS_OF_WEEK, WELLBEING_CATEGORIES, WELLBEING_DELIVERY_SURFACES, WELLBEING_TRIGGERS } from './types.js';

export type ValidationIssue =
  | { readonly kind: 'text-safety'; readonly detail: TextSafetyIssue }
  | { readonly kind: 'no-language-text' }
  | { readonly kind: 'unknown-category'; readonly category: string }
  | { readonly kind: 'unknown-trigger'; readonly trigger: string }
  | { readonly kind: 'no-triggers' }
  | { readonly kind: 'unknown-day-of-week'; readonly day: string }
  | { readonly kind: 'date-order'; readonly startDate: string; readonly endDate: string }
  | { readonly kind: 'invalid-date'; readonly value: string }
  | { readonly kind: 'invalid-time-window'; readonly window: TimeWindow }
  | { readonly kind: 'invalid-timezone'; readonly timezoneId: string }
  | { readonly kind: 'frequency-below-floor'; readonly field: 'minimumIntervalMinutes' | 'repeatCooldownMinutes'; readonly value: number; readonly floor: number }
  | { readonly kind: 'frequency-above-ceiling'; readonly field: 'maximumPerDay'; readonly value: number; readonly ceiling: number }
  | { readonly kind: 'frequency-not-positive'; readonly field: string }
  | { readonly kind: 'adult-supervision-lock-screen-conflict' }
  | { readonly kind: 'adult-supervision-unattended-notification' }
  | { readonly kind: 'invalid-target-scope' }
  | { readonly kind: 'empty-message-id' };

export class WellbeingValidationError extends Error {
  constructor(public readonly issues: readonly ValidationIssue[]) {
    super(`wellbeing message validation failed: ${issues.length} issue(s)`);
    this.name = 'WellbeingValidationError';
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A conservative structural check for IANA timezone identifiers (e.g. "Asia/Riyadh", "UTC").
// It intentionally does not consult a live tz database -- that is a runtime/platform concern.
const TIMEZONE_ID_PATTERN = /^[A-Za-z_]+(?:\/[A-Za-z_-]+){0,2}$/;

export function validateTargetScope(target: TargetScope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (target.mode === 'ONE_CHILD' && target.childProfileIds.length !== 1) issues.push({ kind: 'invalid-target-scope' });
  if (target.mode === 'MULTIPLE_CHILDREN' && target.childProfileIds.length < 2) issues.push({ kind: 'invalid-target-scope' });
  if (target.mode === 'ONE_CHILD' || target.mode === 'MULTIPLE_CHILDREN') {
    if (target.childProfileIds.some((id) => id.trim().length === 0)) issues.push({ kind: 'invalid-target-scope' });
    if (new Set(target.childProfileIds).size !== target.childProfileIds.length) issues.push({ kind: 'invalid-target-scope' });
  }
  return issues;
}

export function validateSchedule(schedule: ScheduleWindow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (schedule.startDate !== undefined && !isIsoDate(schedule.startDate)) issues.push({ kind: 'invalid-date', value: schedule.startDate });
  if (schedule.endDate !== undefined && !isIsoDate(schedule.endDate)) issues.push({ kind: 'invalid-date', value: schedule.endDate });
  if (
    schedule.startDate !== undefined && schedule.endDate !== undefined &&
    isIsoDate(schedule.startDate) && isIsoDate(schedule.endDate) &&
    schedule.startDate > schedule.endDate
  ) {
    issues.push({ kind: 'date-order', startDate: schedule.startDate, endDate: schedule.endDate });
  }

  for (const day of schedule.daysOfWeek) {
    if (!DAYS_OF_WEEK.includes(day)) issues.push({ kind: 'unknown-day-of-week', day });
  }

  for (const window of schedule.timeWindows) {
    const validRange = (m: number) => Number.isInteger(m) && m >= 0 && m < 1440;
    // startMinute === endMinute is rejected as a degenerate (zero-duration) window; startMinute > endMinute
    // is a valid midnight-crossing window (doc 36 section 16 -- schedule presentation windows only).
    if (!validRange(window.startMinute) || !validRange(window.endMinute) || window.startMinute === window.endMinute) {
      issues.push({ kind: 'invalid-time-window', window });
    }
  }

  if (schedule.timezoneId !== undefined && !TIMEZONE_ID_PATTERN.test(schedule.timezoneId)) {
    issues.push({ kind: 'invalid-timezone', timezoneId: schedule.timezoneId });
  }

  return issues;
}

export function validateDeliveryPolicy(delivery: DeliveryPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (delivery.triggers.length === 0) issues.push({ kind: 'no-triggers' });
  for (const trigger of delivery.triggers) {
    if (!WELLBEING_TRIGGERS.includes(trigger)) issues.push({ kind: 'unknown-trigger', trigger });
  }

  if (!(delivery.minimumIntervalMinutes >= MINIMUM_INTERVAL_MINUTES_FLOOR)) {
    issues.push({ kind: 'frequency-below-floor', field: 'minimumIntervalMinutes', value: delivery.minimumIntervalMinutes, floor: MINIMUM_INTERVAL_MINUTES_FLOOR });
  }
  if (!(delivery.repeatCooldownMinutes >= REPEAT_COOLDOWN_MINUTES_FLOOR)) {
    issues.push({ kind: 'frequency-below-floor', field: 'repeatCooldownMinutes', value: delivery.repeatCooldownMinutes, floor: REPEAT_COOLDOWN_MINUTES_FLOOR });
  }
  if (!(delivery.maximumPerDay > 0)) {
    issues.push({ kind: 'frequency-not-positive', field: 'maximumPerDay' });
  } else if (delivery.maximumPerDay > MAXIMUM_PER_DAY_CEILING) {
    issues.push({ kind: 'frequency-above-ceiling', field: 'maximumPerDay', value: delivery.maximumPerDay, ceiling: MAXIMUM_PER_DAY_CEILING });
  }

  if (delivery.requiresAdultSupervision && delivery.lockScreenAllowed) {
    issues.push({ kind: 'adult-supervision-lock-screen-conflict' });
  }

  return issues;
}

/**
 * Adult-supervision surface check. Delivery surface selection is caller-owned (the preview/command
 * layer decides which of WELLBEING_DELIVERY_SURFACES a message uses); this validates that choice
 * against doc 36 section 9 once a surface is known.
 */
export function validateAdultSupervisionSurface(delivery: DeliveryPolicy, surface: (typeof WELLBEING_DELIVERY_SURFACES)[number]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!delivery.requiresAdultSupervision) return issues;
  if (surface === 'LOCK_SCREEN_REDACTED') issues.push({ kind: 'adult-supervision-lock-screen-conflict' });
  if (surface === 'STANDARD_NOTIFICATION') issues.push({ kind: 'adult-supervision-unattended-notification' });
  return issues;
}

export function validateCustomMessage(message: CustomWellbeingMessage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (message.messageId.trim().length === 0) issues.push({ kind: 'empty-message-id' });
  if (!WELLBEING_CATEGORIES.includes(message.category)) issues.push({ kind: 'unknown-category', category: message.category });

  const languageTags = Object.keys(message.languageTexts);
  if (languageTags.length === 0) {
    issues.push({ kind: 'no-language-text' });
  } else {
    for (const tag of languageTags) {
      const text = message.languageTexts[tag];
      for (const issue of validateLanguageText(tag, text.title, text.body)) {
        issues.push({ kind: 'text-safety', detail: issue });
      }
    }
  }

  issues.push(...validateTargetScope(message.target));
  issues.push(...validateSchedule(message.schedule));
  issues.push(...validateDeliveryPolicy(message.delivery));

  return issues;
}

export function assertValidCustomMessage(message: CustomWellbeingMessage): void {
  const issues = validateCustomMessage(message);
  if (issues.length > 0) throw new WellbeingValidationError(issues);
}
