import type { EmailProviderAdapter, EmailSendResult, RenderedEmailMessage } from '../EmailProviderAdapter.js';
import { EmailDeliveryError } from '../EmailProviderAdapter.js';

/**
 * PCA-DW-W2-15F -- the production-safe default when no real email provider
 * has been selected/configured yet (PRODUCTION_PROVIDER_CONFIGURED = NO).
 * Every send attempt fails loudly and immediately -- never silently
 * succeeds, never falls back to a sandbox/log-only behaviour. Mirrors
 * main.ts's existing RejectingEmailSender at the provider-adapter layer, so
 * EmailService's own outbox/retry machinery is fully exercised even before
 * a real provider is chosen (a send is genuinely attempted, durably
 * retried per policy, and eventually dead-lettered -- exactly as it would
 * behave against a real, persistently-failing provider).
 *
 * Marked RETRYABLE (not a permanent failure): if an operator finishes
 * configuring a real provider WHILE a message is still within its retry
 * window (EMAIL_MAX_ATTEMPTS, a few minutes total), it still has a chance
 * to go out instead of already being dead-lettered the instant that
 * happens -- a strictly better outcome than dead-lettering on the very
 * first attempt, at no real cost (EMAIL_MAX_ATTEMPTS still bounds how long
 * an unconfigured system keeps retrying).
 */
export class RejectingEmailProviderAdapter implements EmailProviderAdapter {
  readonly providerName = 'REJECTING_NO_PROVIDER_CONFIGURED';

  async send(_message: RenderedEmailMessage): Promise<EmailSendResult> {
    throw new EmailDeliveryError(
      'No production email provider is configured (PCA_EMAIL_PROVIDER unset or incomplete). Refusing to silently drop or fabricate a delivery.',
      true,
    );
  }
}
