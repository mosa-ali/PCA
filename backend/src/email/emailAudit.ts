/**
 * PCA-DW-W2-15F -- redacted delivery audit. NEVER the recipient email or
 * the code, only what's needed to see delivery health at a glance: which
 * template kind, which provider, the outcome, and how many attempts it
 * took. Mirrors TestSandboxEmailSender's existing redaction discipline
 * (`code.length`, never the code) at the real-provider layer.
 */

export type EmailAuditOutcome = 'SENT' | 'RETRY_SCHEDULED' | 'DEAD_LETTER';

export interface EmailAuditEvent {
  readonly kind: 'VERIFICATION' | 'PASSWORD_RESET';
  readonly providerName: string;
  readonly outcome: EmailAuditOutcome;
  readonly attemptCount: number;
}

export type EmailAuditSink = (event: EmailAuditEvent) => void;

export const logRedactedEmailAuditEvent: EmailAuditSink = (event) => {
  // eslint-disable-next-line no-console -- structured, redacted operational logging; never the recipient or code.
  console.info(`[EmailService] kind=${event.kind} provider=${event.providerName} outcome=${event.outcome} attempt=${event.attemptCount}`);
};
