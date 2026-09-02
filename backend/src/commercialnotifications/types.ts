/**
 * PCA-COMMERCIAL-NOTIFY-1 -- durable commercial notification event/read
 * model. See migrations/0012_commercial_notifications.sql for the schema
 * this module reads and writes.
 */

/** The closed vocabulary migration 0012's CHECK constraint enforces (widened
 * by migration 0033 to add `RENEWAL_UPCOMING`). */
export type CommercialNotificationEventType =
  | 'QUOTE_READY'
  | 'PAYMENT_CONFIRMED'
  | 'ENTITLEMENT_INCREASED'
  | 'PAYMENT_FAILED'
  | 'REQUEST_DENIED'
  | 'QUOTE_EXPIRED'
  /**
   * migration 0033: a purely internal, provider-neutral "your subscription
   * renews soon" reminder -- published by
   * CommercialMaintenanceRunner.publishPendingRenewalUpcomingNotifications
   * ahead of an actual renewal charge/cycle (billing_subscriptions.current_period_end,
   * see billing/subscription.ts). Distinct from `auto_renew` (migration
   * 0031): that flag/mutation is about a parent's stated renewal
   * preference; this event is a proactive heads-up notification, and never
   * itself charges anyone or talks to a payment provider.
   */
  | 'RENEWAL_UPCOMING';

export const COMMERCIAL_NOTIFICATION_EVENT_TYPES: readonly CommercialNotificationEventType[] = [
  'QUOTE_READY',
  'PAYMENT_CONFIRMED',
  'ENTITLEMENT_INCREASED',
  'PAYMENT_FAILED',
  'REQUEST_DENIED',
  'QUOTE_EXPIRED',
  'RENEWAL_UPCOMING',
];

/**
 * Safe localization parameters only -- structured, server-controlled
 * values a client-side EN/AR localizer substitutes into the string named
 * by `messageKey`. Never free text, never a pre-rendered sentence (mission
 * Section 4). Values are bounded to primitives so this can never become a
 * backdoor for an unbounded/unsafe payload.
 */
export type CommercialNotificationParams = Readonly<Record<string, string | number | boolean | null>>;

export interface CommercialNotificationRow {
  readonly notificationId: string;
  readonly accountRef: string;
  readonly eventType: CommercialNotificationEventType;
  readonly dedupeKey: string;
  readonly resourceRef: string | null;
  readonly messageKey: string;
  readonly params: CommercialNotificationParams | null;
  readonly createdAt: Date;
  readonly readAt: Date | null;
  readonly acknowledgedAt: Date | null;
}

/** The Section 7 "Platform Support View" projection -- event type, status, opaque account ref only, no message content whatsoever. */
export interface CommercialNotificationSupportRow {
  readonly notificationId: string;
  readonly accountRef: string;
  readonly eventType: CommercialNotificationEventType;
  readonly createdAt: Date;
  readonly readAt: Date | null;
  readonly acknowledgedAt: Date | null;
}

export interface PublishCommercialNotificationInput {
  readonly accountRef: string;
  readonly eventType: CommercialNotificationEventType;
  /**
   * The durable idempotency identity (migration 0012's UNIQUE
   * `dedupe_key`). The caller (a Quote/Payment/Entitlement/Request domain,
   * via CommercialNotificationPublisher) MUST derive this deterministically
   * from the logical source event -- e.g.
   * `PAYMENT_CONFIRMED:<provider_event_row_id>`,
   * `ENTITLEMENT_INCREASED:<change_request_id>`, `QUOTE_EXPIRED:<quote_id>`
   * -- so a duplicate webhook/activation/retry can never produce a second
   * notification row.
   */
  readonly dedupeKey: string;
  readonly resourceRef: string | null;
  readonly messageKey: string;
  readonly params: CommercialNotificationParams | null;
}
