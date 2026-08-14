import type { PlatformAdminId, PlatformAdminRole } from '../auth/types.js';

/**
 * PCA-ADD-PA-045: the closed vocabulary of Platform Administration audit
 * event types. This array is the single source of truth --
 * migrations/0005_platform_admin_identity_rbac_audit.sql's
 * `platform_admin_audit_events_event_type_check` CHECK constraint is a
 * hand-transcribed copy of it; a reviewer changing one MUST change the
 * other, and this comment is the anchor both sides point back to.
 *
 * The Billing/entitlement event types (PRICE_BOOK_CHANGED, QUOTE_ISSUED,
 * PAYMENT_CONFIRMED, ENTITLEMENT_INCREASED, PAYMENT_ROLLED_BACK,
 * DEVICE_LIMIT_CHANGED, LIMIT_REQUEST_APPROVED, LIMIT_REQUEST_DENIED,
 * PLAN_CHANGED, PAYMENT_REFUNDED, BANK_SETTING_CHANGED) are included ONLY
 * so the vocabulary is future-proof per PCA-ADD-PA-045's explicit
 * instruction -- no code in this PCA-PA-1 lane ever constructs an event of
 * any of those types. Only the auth/session/audit event types below that
 * are actually emitted by backend/src/platformadmin/auth are exercised by
 * this lane's services and tests.
 */
export const PLATFORM_ADMIN_AUDIT_EVENT_TYPES = [
  'ADMIN_LOGIN',
  'ADMIN_LOGIN_FAILED',
  'ADMIN_CREATED',
  'ADMIN_ROLE_CHANGED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_REACTIVATED',
  'DEVICE_LIMIT_CHANGED',
  'LIMIT_REQUEST_APPROVED',
  'LIMIT_REQUEST_DENIED',
  'PLAN_CHANGED',
  'PAYMENT_REFUNDED',
  'BANK_SETTING_CHANGED',
  'SETTING_CHANGED',
  'PRICE_BOOK_CHANGED',
  'QUOTE_ISSUED',
  'PAYMENT_CONFIRMED',
  'ENTITLEMENT_INCREASED',
  'PAYMENT_ROLLED_BACK',
  // PCA-PA-1-specific event types actually emitted by this lane's code:
  'ADMIN_SESSION_REVOKED',
  'ADMIN_LOGIN_LOCKED_OUT',
  'ADMIN_STEP_UP_GRANTED',
  'ADMIN_STEP_UP_DENIED',
  'ADMIN_MFA_ENROLLED',
] as const;

export type PlatformAdminAuditEventType = (typeof PLATFORM_ADMIN_AUDIT_EVENT_TYPES)[number];

export type PlatformAdminAuditResult = 'SUCCESS' | 'FAILURE' | 'DENIED';

/** Mirrors doc 18 Section 5's MAX_AUDIT_NOTE_LENGTH free-text-minimization discipline (PCA-ADD-PA-046). */
export const MAX_AUDIT_METADATA_BYTES = 2048;

export interface PlatformAdminAuditEvent {
  eventId: string;
  eventType: PlatformAdminAuditEventType;
  /** NULL for pre-authentication events (e.g. a failed login for an unrecognized email) and the bootstrap-created first APP_OWNER. */
  actorAdminId: PlatformAdminId | null;
  actorRole: PlatformAdminRole | null;
  /** Opaque reference only, e.g. `admin:<uuid>` or `session:<uuid>` -- never a family/child identifier. */
  targetRef: string | null;
  result: PlatformAdminAuditResult;
  occurredAt: Date;
  correlationId: string;
  /** Structured, non-secret, length-bounded operational metadata only -- see validateAndTruncateMetadata. */
  metadata: Record<string, unknown> | null;
}

export class PlatformAdminAuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformAdminAuditValidationError';
  }
}

function isPlatformAdminAuditEventType(value: string): value is PlatformAdminAuditEventType {
  return (PLATFORM_ADMIN_AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validates event_type against the closed vocabulary above (a programming
 * error, never an attacker-controlled input, so it throws rather than
 * returning a soft failure -- mirrors authz/policy.ts's
 * resolveRequirements no-default-case discipline) and serializes+enforces
 * the metadata byte-length cap. Every audit event MUST pass through this
 * function before being persisted -- see
 * PlatformAdminAuditService.record and
 * MySqlPlatformAdminAuthRepository's internal transactional audit writes.
 */
export function validateAuditEvent(event: PlatformAdminAuditEvent): { metadataJson: string | null } {
  if (!isPlatformAdminAuditEventType(event.eventType)) {
    throw new Error(`Unknown Platform Administration audit event type: ${event.eventType}`);
  }
  if (event.targetRef !== null && (event.targetRef.length === 0 || event.targetRef.length > 128)) {
    throw new Error('Platform Administration audit event targetRef must be between 1 and 128 characters.');
  }
  if (event.metadata === null) return { metadataJson: null };
  const serialized = JSON.stringify(event.metadata);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > MAX_AUDIT_METADATA_BYTES) {
    throw new PlatformAdminAuditValidationError(
      `Platform Administration audit event metadata exceeds ${MAX_AUDIT_METADATA_BYTES} bytes (was ${byteLength}).`,
    );
  }
  return { metadataJson: serialized };
}

export type PlatformAdminAuditQueryFilter = {
  eventType?: PlatformAdminAuditEventType;
  sinceOccurredAt?: Date;
  limit?: number;
};
