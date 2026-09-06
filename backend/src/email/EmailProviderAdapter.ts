/**
 * PCA-DW-W2-15F -- the provider-adapter seam every real email transport
 * (SMTP, Microsoft Graph, and any future provider) implements. Mirrors
 * billing/provider/providerContract.ts's PaymentProvider seam: EmailService
 * (the sole caller of these adapters) never depends on a specific
 * provider's SDK/wire format, only on this interface, so adding a provider
 * later is an additive adapter, not a change to business logic.
 */

export interface RenderedEmailMessage {
  readonly toEmail: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailSendResult {
  readonly providerMessageId: string;
}

/**
 * PCA-DW-W2-R1-8 -- a bounded, safe classification of WHY a delivery
 * attempt failed. This -- never EmailDeliveryError's own free-text
 * `message` -- is what EmailOutboxProcessor persists to
 * email_outbox.last_error and passes to the audit sink. A real provider's
 * error text can contain the recipient address, SMTP envelope content,
 * hostnames, or other operational detail that must never land in the
 * central DB or logs; a fixed category never can.
 */
export type EmailProviderErrorCategory =
  | 'EMAIL_PROVIDER_TIMEOUT'
  | 'EMAIL_PROVIDER_RATE_LIMITED'
  | 'EMAIL_PROVIDER_AUTH_FAILED'
  | 'EMAIL_PROVIDER_REJECTED'
  | 'EMAIL_PROVIDER_NETWORK'
  | 'EMAIL_PROVIDER_CONFIGURATION'
  | 'EMAIL_PROVIDER_UNKNOWN';

export class EmailDeliveryError extends Error {
  /** True for a failure that another attempt might succeed at (timeout, 5xx, throttling) -- false for one that never will (invalid recipient, auth rejected, malformed request). EmailOutboxProcessor uses this to decide retry vs. immediate dead-letter. */
  readonly retryable: boolean;
  /** The only thing about this failure that ever reaches the DB/audit sink -- see this type's own doc comment. `message` (inherited from Error) may carry raw provider detail and must stay in-process/ephemeral only. */
  readonly category: EmailProviderErrorCategory;
  constructor(message: string, retryable: boolean, category: EmailProviderErrorCategory, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailDeliveryError';
    this.retryable = retryable;
    this.category = category;
  }
}

export interface EmailProviderAdapter {
  readonly providerName: string;
  send(message: RenderedEmailMessage): Promise<EmailSendResult>;
}
