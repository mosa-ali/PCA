import type { PoolConnection } from 'mysql2/promise';
import type {
  ComplimentaryEntitlementType,
  ComplimentaryGrantRecord,
  CreateComplimentaryGrantInput,
  OpaqueFamilyId,
} from './types.js';

/**
 * Persistence port for complimentary entitlement grants
 * (PCA-ADD-COMP-003/022). Every mutating method takes an explicit `conn`
 * so the caller can compose the mutation and its audit-event write in the
 * SAME transaction (PCA-ADD-COMP-016's "same-transaction as the mutation"
 * requirement), matching this codebase's existing repository convention
 * (see EntitlementRepository/MySqlEntitlementRepository).
 *
 * CONCURRENCY (PCA-ADD-COMP-006/021/022): `tryRevoke`/`tryExpireAll` are
 * database-authoritative conditional `UPDATE ... WHERE status = 'ACTIVE'`
 * operations -- the same pattern `QuoteRepository.tryConsume` already
 * establishes for the Billing domain -- never an in-memory lock, since more
 * than one backend instance may process a mutation concurrently. Grant
 * CREATION additionally cannot double-apply because it is gated by a
 * single-use step-up token one layer up
 * (PlatformAdminComplimentaryGrantService/PlatformAdminAuthService.consumeStepUp)
 * -- a retried create request with the same stepUpId fails at the auth
 * layer before this repository is ever called a second time.
 */
export interface ComplimentaryGrantRepository {
  /** Inserts a new grant row. Never mutates any other grant or the base account_entitlements row. */
  create(conn: PoolConnection, input: CreateComplimentaryGrantInput, grantId: string, now: Date): Promise<ComplimentaryGrantRecord>;

  getById(conn: PoolConnection, grantId: string): Promise<ComplimentaryGrantRecord | null>;

  /** Locks the row (SELECT ... FOR UPDATE) within an existing transaction. Null if absent. */
  lockById(conn: PoolConnection, grantId: string): Promise<ComplimentaryGrantRecord | null>;

  listForFamily(conn: PoolConnection, familyId: OpaqueFamilyId): Promise<ComplimentaryGrantRecord[]>;

  /**
   * PCA-ADD-COMP-005: sum of `amount_or_allowance` across every currently
   * ACTIVE, currently-effective (`effective_from <= asOf` AND
   * (`expires_at IS NULL` OR `expires_at > asOf`)) grant for
   * (familyId, entitlementType). Never includes REVOKED/EXPIRED rows, and
   * never includes a not-yet-effective future-dated grant.
   */
  sumActiveAmount(conn: PoolConnection, familyId: OpaqueFamilyId, entitlementType: ComplimentaryEntitlementType, asOf: Date): Promise<number>;

  /**
   * PCA-ADD-COMP-006/022: conditional `UPDATE ... WHERE status = 'ACTIVE'`.
   * Returns `{applied: true, record}` if THIS call performed the
   * ACTIVE->REVOKED transition; `{applied: false, record}` if the grant was
   * already REVOKED or EXPIRED (idempotent no-op -- caller must not emit a
   * second audit event or treat this as an error); `{applied: false,
   * record: null}` if the grant does not exist at all.
   */
  tryRevoke(conn: PoolConnection, grantId: string, revokedByAdminId: string, now: Date): Promise<{ applied: boolean; record: ComplimentaryGrantRecord | null }>;

  /**
   * PCA-ADD-COMP-006/022: conditional `UPDATE ... WHERE status = 'ACTIVE'`
   * changing only `expires_at` (renew/extend, or shorten). Same
   * applied/idempotency contract as tryRevoke.
   */
  tryRenew(conn: PoolConnection, grantId: string, newExpiresAt: Date | null, now: Date): Promise<{ applied: boolean; record: ComplimentaryGrantRecord | null }>;

  /**
   * PCA-ADD-COMP-011: sweeps every ACTIVE-but-past-expiry grant for one
   * family to EXPIRED via a single conditional
   * `UPDATE ... WHERE status = 'ACTIVE' AND expires_at <= ?`, returning the
   * rows THIS call actually transitioned (for the caller to emit exactly
   * one COMPLIMENTARY_GRANT_EXPIRED audit event per transitioned row --
   * never merely because a read noticed expiresAt has passed, mirroring
   * QuoteRepository.expireDueQuotes's exactly-once-per-quote transition
   * authority).
   */
  expireDueForFamily(conn: PoolConnection, familyId: OpaqueFamilyId, now: Date): Promise<ComplimentaryGrantRecord[]>;
}
