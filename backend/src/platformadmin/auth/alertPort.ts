/**
 * PCA-ADD-PA-020: a failed-login or lockout event on an APP_OWNER/
 * FINANCE_ADMIN account must generate an immediate alert to other
 * APP_OWNER accounts, not merely a logged event. This interface is the
 * external integration point operations supplies a real notification
 * channel (email/SMS/paging) through -- no such provider or its secrets
 * are hardcoded anywhere in this codebase (PCA-ADD-PA-020 compliance
 * boundary).
 *
 * adminEmailHash is passed, never a raw email -- LoggingAlertAdapter below
 * proves an alert can be actioned/logged without ever handling plaintext
 * operator PII, and a real adapter (e.g. one backed by a separate
 * email-hash -> notification-address directory) would need to resolve the
 * hash to a destination itself, outside this module.
 */
export interface PlatformAdminAlertEvent {
  kind: 'LOGIN_FAILED' | 'LOCKED_OUT';
  adminEmailHash: Buffer;
  occurredAt: Date;
}

export interface PlatformAdminAlertPort {
  notifyAppOwners(event: PlatformAdminAlertEvent): Promise<void>;
}

/**
 * Reference implementation: writes a structured, non-secret, non-PII log
 * line only. Wiring a real notification channel (email/SMS/paging) is an
 * explicit external integration a future operations workstream supplies by
 * implementing PlatformAdminAlertPort against a real provider -- this
 * adapter is intentionally the only implementation this lane ships.
 */
export class LoggingAlertAdapter implements PlatformAdminAlertPort {
  async notifyAppOwners(event: PlatformAdminAlertEvent): Promise<void> {
    // eslint-disable-next-line no-console -- deliberate structured log line, never a raw email/secret.
    console.warn(
      JSON.stringify({
        alert: 'PLATFORM_ADMIN_SECURITY_ALERT',
        kind: event.kind,
        occurredAt: event.occurredAt.toISOString(),
        emailHashPrefix: event.adminEmailHash.toString('hex').slice(0, 8),
      }),
    );
  }
}
