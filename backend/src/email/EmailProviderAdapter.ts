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

export class EmailDeliveryError extends Error {
  /** True for a failure that another attempt might succeed at (timeout, 5xx, throttling) -- false for one that never will (invalid recipient, auth rejected, malformed request). EmailOutboxProcessor uses this to decide retry vs. immediate dead-letter. */
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailDeliveryError';
    this.retryable = retryable;
  }
}

export interface EmailProviderAdapter {
  readonly providerName: string;
  send(message: RenderedEmailMessage): Promise<EmailSendResult>;
}
