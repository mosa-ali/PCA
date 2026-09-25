const DISMISS_KEY = 'pca_mfa_grace_reminder_dismissed_v1';

/**
 * "Remind me later" hides the authenticator reminder for THIS BROWSER SESSION
 * only. Only the dismissal is stored -- a non-secret "1" flag in
 * sessionStorage, which the browser discards when the session ends, so the
 * reminder reappears on the next visit (and after signing out). The deadline
 * itself is never stored: it always comes from the server's `graceExpiresAt`.
 */
export function isMfaGraceReminderDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissMfaGraceReminder(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Best-effort: the caller's in-memory dismissal still hides it for this page.
  }
}

/** Called on sign-out, so the next person to sign in on this tab sees the reminder. */
export function clearMfaGraceReminderDismissal(): void {
  try {
    window.sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    // Best-effort.
  }
}
