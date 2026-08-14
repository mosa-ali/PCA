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

/** Builds a PlatformAdminAuditEvent for a Billing-domain action -- metadata must be structured, non-secret, length-bounded (validated by validateAuditEvent inside PlatformAdminAuditService's repository, not re-validated here). */
export function buildBillingAuditEvent(params: {
  eventType: PlatformAdminAuditEventType;
  actor: BillingAuditActor;
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
