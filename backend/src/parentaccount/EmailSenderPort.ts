/**
 * Provider-agnostic email-sending seam (PCA-ADD-IDENT-005 / this round's
 * `EmailSenderPort.sendVerificationCode(email, code)`). No concrete
 * production email provider is selected this round -- see
 * TestSandboxEmailSender.ts's header, matching the existing
 * `PAYMENT_PROVIDER_SELECTION`/`TEST_SANDBOX` gate precedent
 * (billing/provider/sandboxProvider.ts) exactly: production
 * (`createDefaultEmailSender`, main.ts wiring is Coordinator-owned) has no
 * real sender wired in this lane, so verification emails simply do not
 * leave the process in production today -- an explicit, honest gap, not a
 * silent failure mode, and it never blocks the rest of the identity flow
 * (registration/verification/session issuance are otherwise fully
 * functional; only actual mailbox delivery is EXTERNAL_GATE'd).
 */
export type ParentSecurityNotice = 'ACCOUNT_ACTIVATED' | 'FIRST_LOGIN' | 'MFA_ENROLLED' | 'MFA_RESET' | 'MFA_RECOVERY_PENDING';

export interface EmailSenderPort {
  sendVerificationCode(email: string, code: string): Promise<void>;
  /**
   * PCA product-completion programme (P1 /login finding): a distinct
   * method (not a reused sendVerificationCode call) because a password-
   * reset email's content is materially different (it must be unambiguous
   * that this was NOT requested at registration) even though it shares the
   * same underlying transport/gate. Same EXTERNAL_GATE posture as
   * sendVerificationCode -- see this interface's own header.
   */
  sendPasswordResetCode(email: string, code: string): Promise<void>;
  /**
   * Owner authentication-architecture decision (2026-09-15): the risk-based
   * step-up code required for a normal parent/family account's first
   * successful login. Distinct method (not a reused sendVerificationCode
   * call) for the same reason sendPasswordResetCode is distinct -- the
   * email content must be unambiguous about which action triggered it.
   */
  sendLoginStepUpCode(email: string, code: string): Promise<void>;
  /** One-time code proving mailbox control for a lost-authenticator (Parent MFA) recovery. */
  sendMfaRecoveryCode(email: string, code: string): Promise<void>;
  /**
   * Security notices (PCA-DEC-037). Carry no code, secret, token or password:
   * only which event happened and when (UTC). `eventId` makes a retried call
   * enqueue once.
   */
  sendSecurityNotice(email: string, notice: ParentSecurityNotice, occurredAt: Date, eventId: string): Promise<void>;
  /** Sends a one-time Platform Admin first-time activation link. */
  sendPlatformAdminActivationLink(email: string, activationUrl: string, token: string): Promise<void>;
}
