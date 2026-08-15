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
export interface EmailSenderPort {
  sendVerificationCode(email: string, code: string): Promise<void>;
}
