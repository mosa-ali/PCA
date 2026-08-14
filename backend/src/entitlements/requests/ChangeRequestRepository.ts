import type { PoolConnection } from 'mysql2/promise';
import type { EntitlementChangeRequestRecord, EntitlementChangeRequestState, LimitType, OpaqueFamilyId, QuoteSnapshot } from '../types.js';

export interface CreateChangeRequestInput {
  requestId: string;
  familyId: OpaqueFamilyId;
  limitType: LimitType;
  currentLimitAtRequest: number;
  targetLimit: number;
  now: Date;
}

/**
 * Persistence port for the increase-request lifecycle
 * (PENDING -> QUOTED -> PAYMENT_PENDING -> APPROVED|DENIED|CANCELLED,
 * PCA-ADD-PA-030) and its transition history. Every state-changing method
 * that accepts `conn` must run within an existing runInTransaction block;
 * every guarded UPDATE is `WHERE request_id = ? AND state = <expected>` so
 * a caller observing a stale state simply gets a no-op (zero rows
 * affected) rather than corrupting a concurrently-transitioned request.
 */
export interface ChangeRequestRepository {
  getById(requestId: string): Promise<EntitlementChangeRequestRecord | null>;
  lockById(conn: PoolConnection, requestId: string): Promise<EntitlementChangeRequestRecord | null>;
  listForFamily(familyId: OpaqueFamilyId): Promise<EntitlementChangeRequestRecord[]>;
  listOpenForFamily(familyId: OpaqueFamilyId): Promise<EntitlementChangeRequestRecord[]>;

  create(conn: PoolConnection, input: CreateChangeRequestInput): Promise<EntitlementChangeRequestRecord>;

  recordTransition(conn: PoolConnection, requestId: string, fromState: EntitlementChangeRequestState | null, toState: EntitlementChangeRequestState, actorAdminId: string | null, now: Date): Promise<void>;

  /** PENDING -> QUOTED, attaching an immutable quote snapshot. Guarded on state = 'PENDING'. */
  attachQuote(conn: PoolConnection, requestId: string, quote: QuoteSnapshot, now: Date): Promise<EntitlementChangeRequestRecord | null>;

  /** PENDING -> PENDING with awaiting_admin_quote = 1 (the PENDING_ADMIN_QUOTE condition, PCA-ADD-PA-050). */
  markAwaitingAdminQuote(conn: PoolConnection, requestId: string, now: Date): Promise<EntitlementChangeRequestRecord | null>;

  /** QUOTED -> PAYMENT_PENDING. Guarded on state = 'QUOTED'. */
  moveToPaymentPending(conn: PoolConnection, requestId: string, now: Date): Promise<EntitlementChangeRequestRecord | null>;

  /** Guarded state -> APPROVED, recording actor/reason/no-charge flag. Caller is responsible for the atomic entitlement raise in the same transaction. */
  markApproved(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], decidedByAdminId: string | null, noChargeOverride: boolean, now: Date): Promise<EntitlementChangeRequestRecord | null>;

  /** Guarded state -> DENIED. */
  markDenied(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], decidedByAdminId: string | null, reason: string, now: Date): Promise<EntitlementChangeRequestRecord | null>;

  /** Guarded state -> CANCELLED. */
  markCancelled(conn: PoolConnection, requestId: string, fromStates: EntitlementChangeRequestState[], now: Date): Promise<EntitlementChangeRequestRecord | null>;
}
