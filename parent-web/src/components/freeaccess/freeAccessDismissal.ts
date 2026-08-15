import type { FreeAccessStatus } from '../../domain/freeAccess';

const STORAGE_KEY = 'pca_free_access_reminder_dismissed_v1';

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC calendar day
}

/**
 * The reminder is dismissible "for the current period" (WRITER61_ASSIGNMENT.md)
 * -- defined here as: the current calendar day, AND the current status
 * "bucket" (status + remainingDays, or status alone for PERPETUAL/EXPIRED).
 * Including the bucket means a dismissal made while the account showed
 * "7 days remaining" never silently suppresses tomorrow's "6 days
 * remaining" state, and a dismissal made while ACTIVE never suppresses a
 * later EXPIRED transition -- every escalation re-surfaces once, even
 * within the same calendar day.
 */
function bucketFor(status: FreeAccessStatus): string {
  if (status.status === 'ACTIVE') return `ACTIVE:${status.remainingDays ?? 'null'}`;
  return status.status; // PERPETUAL/EXPIRED never re-derive a day count
}

function dismissalKey(status: FreeAccessStatus, now: Date): string {
  return `${todayKey(now)}:${bucketFor(status)}`;
}

function readStorage(): string | null {
  try {
    // Not a secret: a non-sensitive UI dismissal marker (a date +
    // status-bucket string, e.g. "2026-08-15:ACTIVE:7"), never
    // credential/session/family data. The repo-wide ban (see
    // .eslintrc.cjs) exists to keep secrets out of localStorage; this
    // value carries no confidentiality requirement at all and genuinely
    // needs to survive a reload, which src/security/secureStorage.ts's
    // in-memory-only store cannot do.
    // eslint-disable-next-line no-restricted-properties
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage can throw (private-browsing quota, disabled storage) --
    // fail open to "not dismissed" (show the reminder), never crash the
    // shell over a persistence nicety.
    return null;
  }
}

export function isFreeAccessReminderDismissed(status: FreeAccessStatus, now: Date = new Date()): boolean {
  return readStorage() === dismissalKey(status, now);
}

export function dismissFreeAccessReminder(status: FreeAccessStatus, now: Date = new Date()): void {
  try {
    // Non-secret UI preference, not sensitive data -- see readStorage's own comment above.
    // eslint-disable-next-line no-restricted-properties
    window.localStorage.setItem(STORAGE_KEY, dismissalKey(status, now));
  } catch {
    // Best-effort only -- see readStorage's own comment.
  }
}
