import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { runInTransaction } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import type { ComplimentaryGrantRepository } from './ComplimentaryGrantRepository.js';
import { computeEffectiveEntitlementSnapshot } from './EffectiveEntitlementCapacity.js';
import {
  COMMERCIAL_ACCESS_MARKER_AMOUNT,
  COMPLIMENTARY_ENTITLEMENT_TYPES,
  COMPLIMENTARY_GRANT_CATEGORIES,
} from './types.js';
import type {
  ComplimentaryEntitlementType,
  ComplimentaryGrantRecord,
  CreateComplimentaryGrantInput,
  EffectiveCapacity,
  EffectiveEntitlementBaseUsage,
  EffectiveEntitlementSnapshot,
  FreeAccessSummary,
  OpaqueFamilyId,
} from './types.js';

const REASON_CODE_MAX_LENGTH = 64;
const INTERNAL_NOTE_MAX_LENGTH = 2000;
const MAX_REASONABLE_AMOUNT = 1_000_000;

export type ComplimentaryGrantErrorCode =
  | 'INVALID_ENTITLEMENT_TYPE'
  | 'INVALID_CATEGORY'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATES'
  | 'INVALID_REASON_CODE'
  | 'INVALID_INTERNAL_NOTE'
  | 'NOT_FOUND'
  | 'ALREADY_TERMINAL';

export class ComplimentaryGrantError extends Error {
  readonly code: ComplimentaryGrantErrorCode;
  constructor(code: ComplimentaryGrantErrorCode, message?: string) {
    super(message ?? `Complimentary grant operation rejected: ${code}`);
    this.name = 'ComplimentaryGrantError';
    this.code = code;
  }
}

export interface ComplimentaryGrantCreateRequest {
  familyId: OpaqueFamilyId;
  entitlementType: ComplimentaryEntitlementType;
  category: (typeof COMPLIMENTARY_GRANT_CATEGORIES)[number];
  amountOrAllowance: number;
  effectiveFrom: Date;
  expiresAt: Date | null;
  reasonCode: string;
  internalNote: string | null;
  grantedByAdminId: string;
}

function validateCreateRequest(request: ComplimentaryGrantCreateRequest): void {
  if (!(COMPLIMENTARY_ENTITLEMENT_TYPES as readonly string[]).includes(request.entitlementType)) {
    throw new ComplimentaryGrantError('INVALID_ENTITLEMENT_TYPE');
  }
  if (!(COMPLIMENTARY_GRANT_CATEGORIES as readonly string[]).includes(request.category)) {
    throw new ComplimentaryGrantError('INVALID_CATEGORY');
  }
  if (!Number.isInteger(request.amountOrAllowance) || request.amountOrAllowance < 0 || request.amountOrAllowance > MAX_REASONABLE_AMOUNT) {
    throw new ComplimentaryGrantError('INVALID_AMOUNT');
  }
  // PCA-ADD-COMP-004: COMMERCIAL_ACCESS is boolean-shaped -- the only
  // representable amount is the fixed marker, never an arbitrary integer
  // (which would otherwise be meaningless for a scope that has no "how
  // many" dimension).
  if (request.entitlementType === 'COMMERCIAL_ACCESS' && request.amountOrAllowance !== COMMERCIAL_ACCESS_MARKER_AMOUNT) {
    throw new ComplimentaryGrantError('INVALID_AMOUNT', 'COMMERCIAL_ACCESS grants must carry amountOrAllowance = 1 (a fixed boolean marker).');
  }
  if (Number.isNaN(request.effectiveFrom.getTime())) throw new ComplimentaryGrantError('INVALID_DATES');
  if (request.expiresAt !== null) {
    if (Number.isNaN(request.expiresAt.getTime()) || request.expiresAt.getTime() <= request.effectiveFrom.getTime()) {
      throw new ComplimentaryGrantError('INVALID_DATES');
    }
  }
  if (request.reasonCode.length === 0 || request.reasonCode.length > REASON_CODE_MAX_LENGTH) {
    throw new ComplimentaryGrantError('INVALID_REASON_CODE');
  }
  if (request.internalNote !== null && request.internalNote.length > INTERNAL_NOTE_MAX_LENGTH) {
    throw new ComplimentaryGrantError('INVALID_INTERNAL_NOTE');
  }
}

/**
 * PCA-COMPLIMENTARY-ENTITLEMENTS-1 -- the plain (non-RBAC-gated) domain
 * service. RBAC/step-up/role-scoped mutation authority lives ONE layer up,
 * in `backend/src/platformadmin/complimentary/PlatformAdminComplimentaryGrantService.ts`
 * -- mirroring the existing `entitlements/EntitlementService` (plain) vs.
 * `platformadmin/entitlements/PlatformAdminEntitlementService` (RBAC/audit)
 * split. This service is also the one the MyKids read-model function
 * (`buildMyKidsComplimentaryReadModel`, delivered to the Coordinator for
 * `familyCommercialRoutes.ts`) composes -- a family-facing read must never
 * require Platform Administration RBAC.
 *
 * EXPIRY (PCA-ADD-COMP-006/011): every method here sweeps due expiries for
 * the family FIRST, inside the same transaction as whatever it is about to
 * do, before computing any effective-capacity value or applying any
 * mutation -- so a grant that has passed its expiresAt can never be
 * counted as ACTIVE by a subsequent read in the same call, closing the
 * "expiry race" window (PCA-ADD-COMP-021). Each row this sweep actually
 * transitions gets exactly one COMPLIMENTARY_GRANT_EXPIRED audit event,
 * same transaction, actorAdminId null (a system transition, not an admin
 * action -- mirrors platform_admin_audit_events' documented convention for
 * pre-authentication/system-triggered rows).
 */
export class ComplimentaryEntitlementService {
  constructor(
    private readonly repository: ComplimentaryGrantRepository,
    private readonly runTx: <T>(fn: (conn: PoolConnection) => Promise<T>) => Promise<T> = runInTransaction,
  ) {}

  private async sweepExpiry(conn: PoolConnection, familyId: OpaqueFamilyId, now: Date): Promise<void> {
    const expired = await this.repository.expireDueForFamily(conn, familyId, now);
    for (const grant of expired) {
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'COMPLIMENTARY_GRANT_EXPIRED',
        actorAdminId: null,
        actorRole: null,
        targetRef: `complimentary-grant:${grant.grantId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { grantId: grant.grantId, familyId: grant.familyId, entitlementType: grant.entitlementType, category: grant.category },
      });
    }
  }

  async createGrant(request: ComplimentaryGrantCreateRequest, now: Date): Promise<ComplimentaryGrantRecord> {
    validateCreateRequest(request);
    const grantId = randomUUID();
    return this.runTx(async (conn) => {
      await this.sweepExpiry(conn, request.familyId, now);
      const record = await this.repository.create(
        conn,
        {
          familyId: request.familyId,
          entitlementType: request.entitlementType,
          category: request.category,
          amountOrAllowance: request.amountOrAllowance,
          effectiveFrom: request.effectiveFrom,
          expiresAt: request.expiresAt,
          reasonCode: request.reasonCode,
          internalNote: request.internalNote,
          grantedByAdminId: request.grantedByAdminId,
        },
        grantId,
        now,
      );
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'COMPLIMENTARY_GRANT_CREATED',
        actorAdminId: request.grantedByAdminId,
        actorRole: null,
        targetRef: `complimentary-grant:${record.grantId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: {
          grantId: record.grantId,
          familyId: record.familyId,
          entitlementType: record.entitlementType,
          category: record.category,
          amountOrAllowance: record.amountOrAllowance,
          reasonCode: record.reasonCode,
        },
      });
      return record;
    });
  }

  /** Idempotent per PCA-ADD-COMP-006: an already-REVOKED/EXPIRED grant returns its current record with no new mutation or audit event. */
  async revokeGrant(grantId: string, revokedByAdminId: string, reasonCode: string, now: Date): Promise<ComplimentaryGrantRecord> {
    if (reasonCode.length === 0 || reasonCode.length > REASON_CODE_MAX_LENGTH) throw new ComplimentaryGrantError('INVALID_REASON_CODE');
    return this.runTx(async (conn) => {
      const existing = await this.repository.lockById(conn, grantId);
      if (!existing) throw new ComplimentaryGrantError('NOT_FOUND');
      await this.sweepExpiry(conn, existing.familyId, now);
      const { applied, record } = await this.repository.tryRevoke(conn, grantId, revokedByAdminId, now);
      if (!record) throw new ComplimentaryGrantError('NOT_FOUND');
      if (applied) {
        await insertPlatformAdminAuditEventRow(conn, {
          eventId: randomUUID(),
          eventType: 'COMPLIMENTARY_GRANT_REVOKED',
          actorAdminId: revokedByAdminId,
          actorRole: null,
          targetRef: `complimentary-grant:${grantId}`,
          result: 'SUCCESS',
          occurredAt: now,
          correlationId: randomUUID(),
          metadata: { grantId, familyId: record.familyId, entitlementType: record.entitlementType, category: record.category, reasonCode },
        });
      }
      return record;
    });
  }

  /** Idempotent per PCA-ADD-COMP-006: retrying with the same target expiry is a no-op UPDATE (still succeeds) but never emits a duplicate audit event for a call that changed nothing meaningful beyond revision. */
  async renewGrant(grantId: string, newExpiresAt: Date | null, now: Date): Promise<ComplimentaryGrantRecord> {
    if (newExpiresAt !== null && (Number.isNaN(newExpiresAt.getTime()) || newExpiresAt.getTime() <= now.getTime())) {
      throw new ComplimentaryGrantError('INVALID_DATES');
    }
    return this.runTx(async (conn) => {
      const existing = await this.repository.lockById(conn, grantId);
      if (!existing) throw new ComplimentaryGrantError('NOT_FOUND');
      await this.sweepExpiry(conn, existing.familyId, now);
      const { applied, record } = await this.repository.tryRenew(conn, grantId, newExpiresAt, now);
      if (!record) throw new ComplimentaryGrantError('NOT_FOUND');
      if (!applied) throw new ComplimentaryGrantError('ALREADY_TERMINAL', 'Grant is REVOKED or EXPIRED and can no longer be renewed.');
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'COMPLIMENTARY_GRANT_CHANGED',
        actorAdminId: null,
        actorRole: null,
        targetRef: `complimentary-grant:${grantId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { grantId, familyId: record.familyId, entitlementType: record.entitlementType, newExpiresAt: newExpiresAt ? newExpiresAt.toISOString() : null },
      });
      return record;
    });
  }

  async listForFamily(familyId: OpaqueFamilyId, now: Date): Promise<ComplimentaryGrantRecord[]> {
    return this.runTx(async (conn) => {
      await this.sweepExpiry(conn, familyId, now);
      return this.repository.listForFamily(conn, familyId);
    });
  }

  /** PCA-ADD-COMP-005: BASE/PLAN_ALLOWANCE + sum(ACTIVE grants), computed fresh -- never a stored/cached value. */
  async computeEffectiveCapacity(familyId: OpaqueFamilyId, entitlementType: ComplimentaryEntitlementType, baseAmount: number, now: Date): Promise<EffectiveCapacity> {
    return this.runTx(async (conn) => {
      await this.sweepExpiry(conn, familyId, now);
      const complimentaryAmount = await this.repository.sumActiveAmount(conn, familyId, entitlementType, now);
      return { entitlementType, baseAmount, complimentaryAmount, effectiveTotal: baseAmount + complimentaryAmount };
    });
  }

  /**
   * EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
   * Round6) -- generalizes `computeEffectiveCapacity` above into the full
   * frozen `EffectiveEntitlementSnapshot` shape (both limit types at once,
   * plus usage/over-limit flags), for callers that don't already hold an
   * open transaction/connection (e.g. the MyKids read model). Sweeps due
   * expiries first, same as every other method on this service, then
   * delegates the actual base+complimentary assembly to the shared SSOT
   * function in `EffectiveEntitlementCapacity.ts` -- the SAME function
   * `MySqlSlotReservationRepository`/`MySqlEntitlementRepository`/
   * `EntitlementService.getEffectiveSnapshot` call, so there is exactly one
   * place the `base + sum(active grants)` arithmetic is defined.
   */
  async computeEffectiveEntitlementSnapshot(familyId: OpaqueFamilyId, base: EffectiveEntitlementBaseUsage, now: Date): Promise<EffectiveEntitlementSnapshot> {
    return this.runTx(async (conn) => {
      await this.sweepExpiry(conn, familyId, now);
      return computeEffectiveEntitlementSnapshot(conn, this.repository, familyId, base, now);
    });
  }

  /**
   * PCA-ADD-COMP-018: the MyKids-safe free-access summary. Perpetual wins
   * over time-limited if a family somehow holds more than one active
   * COMMERCIAL_ACCESS grant simultaneously (e.g. a STAFF_FAMILY perpetual
   * grant alongside an earlier now-superseded PROMOTION grant) -- a family
   * is never told they have LESS free access than they actually do.
   */
  async buildFreeAccessSummary(familyId: OpaqueFamilyId, now: Date): Promise<FreeAccessSummary | null> {
    return this.runTx(async (conn) => {
      await this.sweepExpiry(conn, familyId, now);
      const grants = await this.repository.listForFamily(conn, familyId);
      const activeAccess = grants.filter(
        (g) => g.entitlementType === 'COMMERCIAL_ACCESS' && g.status === 'ACTIVE' && g.effectiveFrom.getTime() <= now.getTime() && (g.expiresAt === null || g.expiresAt.getTime() > now.getTime()),
      );
      if (activeAccess.length === 0) return null;
      const perpetual = activeAccess.find((g) => g.expiresAt === null);
      if (perpetual) return { mode: 'PERPETUAL', expiresAt: null, remainingDays: null };
      const latestExpiry = activeAccess.reduce((latest, g) => (g.expiresAt && (!latest || g.expiresAt.getTime() > latest.getTime()) ? g.expiresAt : latest), null as Date | null);
      if (!latestExpiry) return null;
      const remainingMs = latestExpiry.getTime() - now.getTime();
      const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
      return { mode: 'TIME_LIMITED', expiresAt: latestExpiry, remainingDays };
    });
  }
}
