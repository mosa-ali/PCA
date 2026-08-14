/**
 * PCA-COMMERCIAL-NOTIFY-1 -- narrow internal publish interface (mission
 * Section 8), so the Quote/Payment/Entitlement/Request domains can emit
 * safe commercial events without depending on this lane's persistence
 * details, and without this lane editing those domains' accepted source
 * files to wire itself in. See this lane's final report's
 * SHARED_INTEGRATION_REQUIRED list for the concrete call sites a future
 * integration pass should add `publisher.publish(...)` calls at.
 *
 * Every publish is idempotent by construction: `dedupeKey` is the caller's
 * responsibility (see types.ts's PublishCommercialNotificationInput doc),
 * and `CommercialNotificationRepository.recordIfNew` never creates a second
 * row for the same key, so a caller may call `publish` unconditionally on
 * every retry/redelivery of its own source event without any pre-check.
 */

import { CommercialNotificationRepository } from './CommercialNotificationRepository.js';
import type { CommercialNotificationRow, PublishCommercialNotificationInput } from './types.js';

export type PublishOutcome = { readonly outcome: 'PUBLISHED' | 'ALREADY_PUBLISHED'; readonly notification: CommercialNotificationRow };

export interface CommercialNotificationPublisher {
  publish(input: PublishCommercialNotificationInput, now?: Date): Promise<PublishOutcome>;
}

/** Default message keys a caller may use verbatim, or override per call (e.g. to add a market/currency-specific variant) via PublishCommercialNotificationInput.messageKey. */
export const DEFAULT_MESSAGE_KEYS: Readonly<Record<PublishCommercialNotificationInput['eventType'], string>> = {
  QUOTE_READY: 'commercial_notification.quote_ready',
  PAYMENT_CONFIRMED: 'commercial_notification.payment_confirmed',
  ENTITLEMENT_INCREASED: 'commercial_notification.entitlement_increased',
  PAYMENT_FAILED: 'commercial_notification.payment_failed',
  REQUEST_DENIED: 'commercial_notification.request_denied',
  QUOTE_EXPIRED: 'commercial_notification.quote_expired',
};

export class MySqlCommercialNotificationPublisher implements CommercialNotificationPublisher {
  constructor(private readonly repository: CommercialNotificationRepository) {}

  async publish(input: PublishCommercialNotificationInput, now: Date = new Date()): Promise<PublishOutcome> {
    const result = await this.repository.recordIfNew(input, now);
    return { outcome: result.outcome === 'RECORDED' ? 'PUBLISHED' : 'ALREADY_PUBLISHED', notification: result.row };
  }
}
