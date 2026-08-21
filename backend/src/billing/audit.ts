/**
 * PCA Billing Core -- audit event construction helpers over Agent41's
 * existing PlatformAdminAuditService (backend/src/platformadmin/audit/**,
 * read-only reuse, never modified). This lane is the first to actually
 * CONSTRUCT events of the Billing-domain event types
 * (`PRICE_BOOK_CHANGED`, `QUOTE_ISSUED`, `PAYMENT_CONFIRMED`,
 * `PAYMENT_REFUNDED`) that
 * backend/src/platformadmin/audit/types.ts's PLATFORM_ADMIN_AUDIT_EVENT_TYPES
 * already reserved for exactly this purpose (see that file's own header
 * comment).
 */

import { randomUUID } from 'node:crypto';
import type { PlatformAdminAuditEvent, PlatformAdminAuditEventType, PlatformAdminAuditResult } from '../platformadmin/audit/types.js';
import type { PlatformAdminId, PlatformAdminRole } from '../platformadmin/auth/types.js';

export interface BillingAuditActor {
  adminId: PlatformAdminId;
  role: PlatformAdminRole | null;
}

/**
 * A strictly wider actor shape accepted by buildBillingAuditEvent/
 * confirmPaymentAttempt ONLY -- adminId may be null for a genuinely
 * system-triggered event with no real Platform Administration account
 * behind it (e.g. WebhookService's provider-initiated confirmations/
 * anomaly audits). Deliberately NOT used for BillingAuditActor itself:
 * every other caller of that shared type (price book publish, quote
 * issuance, refund operations) writes actor.adminId into its OWN
 * repository call as a required "who did this" column, and must keep
 * requiring a genuine admin -- widening BillingAuditActor itself would
 * have silently let those call sites compile with a null id they can
 * never actually receive.
 */
export interface BillingAuditActorOrSystem {
  adminId: PlatformAdminId | null;
  role: PlatformAdminRole | null;
}

/** Builds a PlatformAdminAuditEvent for a Billing-domain action -- metadata must be structured, non-secret, length-bounded (validated by validateAuditEvent inside PlatformAdminAuditService's repository, not re-validated here). */
export function buildBillingAuditEvent(params: {
  eventType: PlatformAdminAuditEventType;
  actor: BillingAuditActorOrSystem;
  targetRef: string;
  result?: PlatformAdminAuditResult;
  occurredAt: Date;
  metadata?: Record<string, unknown> | null;
}): PlatformAdminAuditEvent {
  return {
    eventId: randomUUID(),
    eventType: params.eventType,
    actorAdminId: params.actor.adminId,
    actorRole: params.actor.role,
    targetRef: params.targetRef,
    result: params.result ?? 'SUCCESS',
    occurredAt: params.occurredAt,
    correlationId: randomUUID(),
    metadata: params.metadata ?? null,
  };
}
