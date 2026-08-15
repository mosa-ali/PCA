import { beforeEach, describe, expect, it } from 'vitest';
import { dismissFreeAccessReminder, isFreeAccessReminderDismissed } from '../../src/components/freeaccess/freeAccessDismissal';
import type { FreeAccessStatus } from '../../src/domain/freeAccess';

const ACTIVE_7: FreeAccessStatus = { mode: 'TIME_LIMITED', grantedAt: '2026-07-16T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z', remainingDays: 7, status: 'ACTIVE' };
const NOW = new Date('2026-08-08T12:00:00.000Z');

describe('freeAccessDismissal', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is not dismissed before dismissFreeAccessReminder is ever called', () => {
    expect(isFreeAccessReminderDismissed(ACTIVE_7, NOW)).toBe(false);
  });

  it('is dismissed for the same status/day after dismissing', () => {
    dismissFreeAccessReminder(ACTIVE_7, NOW);
    expect(isFreeAccessReminderDismissed(ACTIVE_7, NOW)).toBe(true);
  });

  it('a dismissal does not persist to the next calendar day', () => {
    dismissFreeAccessReminder(ACTIVE_7, NOW);
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(isFreeAccessReminderDismissed(ACTIVE_7, nextDay)).toBe(false);
  });

  it('a dismissal made at remainingDays=7 does NOT suppress a later, more urgent remainingDays=1 state on the SAME day', () => {
    dismissFreeAccessReminder(ACTIVE_7, NOW);
    const oneDayLeft: FreeAccessStatus = { ...ACTIVE_7, remainingDays: 1 };
    expect(isFreeAccessReminderDismissed(oneDayLeft, NOW)).toBe(false);
  });

  it('a dismissal made while ACTIVE does NOT suppress a later EXPIRED transition on the SAME day', () => {
    dismissFreeAccessReminder(ACTIVE_7, NOW);
    const expired: FreeAccessStatus = { ...ACTIVE_7, remainingDays: null, status: 'EXPIRED' };
    expect(isFreeAccessReminderDismissed(expired, NOW)).toBe(false);
  });

  it('dismissing EXPIRED itself is honored for the rest of that day', () => {
    const expired: FreeAccessStatus = { ...ACTIVE_7, remainingDays: null, status: 'EXPIRED' };
    dismissFreeAccessReminder(expired, NOW);
    expect(isFreeAccessReminderDismissed(expired, NOW)).toBe(true);
  });
});
